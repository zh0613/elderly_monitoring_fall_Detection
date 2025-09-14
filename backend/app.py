
import base64
import io
import os
import time
from datetime import datetime
from PIL import ImageDraw, ImageFont
from typing import Optional, List, Dict
import requests
import json


from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO
from pymongo import MongoClient
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from collections import Counter
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD"))
IOU_THRESHOLD = float(os.getenv("IOU_THRESHOLD"))
SAVE_DEBUG_IMAGES = os.getenv("SAVE_DEBUG_IMAGES").lower() == "true"

client = AsyncIOMotorClient(MONGO_URI)
db = client[MONGO_DB]
detections_col = db["detections"]
collection = db["detections"]


MODEL_PATH = os.path.join("model", "best.pt")
model = YOLO(MODEL_PATH)

app = FastAPI(title="Fall Detection Platform", version="1.0")
app.mount("/storage", StaticFiles(directory="storage"), name="storage")

origins = [
    "http://localhost:5173",]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

class BBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float
    cls: str

    def to_dict(self):
        return self.model_dump()  

class DetectResult(BaseModel):
    timestamp: str
    source: str
    status: str
    fall_count: int
    person_count: int
    total_frames: int
    falls: Optional[int] = 0
    boxes: Optional[List[Dict]] = None

class MonitoringSettings(BaseModel):
    monitoring_start_hour: int = 6
    monitoring_end_hour: int = 7
    inactivity_threshold: int = 10
    no_person_threshold: int = 5


monitoring_settings = MonitoringSettings()

MODEL_PATH = os.path.join("model", "best.pt")
model = YOLO(MODEL_PATH)

def run_inference(pil_img: Image.Image):
    results = model.predict(
        pil_img,
        conf=CONF_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False
    )
    r = results[0]
    boxes = []

    names = r.names

    if r.boxes is not None and len(r.boxes) > 0:
        for b in r.boxes:
            cls_id = int(b.cls.item())
            cls_name = names.get(cls_id, str(cls_id))
            conf = float(b.conf.item())
            x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]

            
            if cls_name.lower() in ["fall", "person"]:
                boxes.append(
                    BBox(x1=x1, y1=y1, x2=x2, y2=y2, conf=conf, cls=cls_name)
                )

    return boxes

def save_detection(result: DetectResult):
    detections_col.insert_one(result.dict())

@app.get("/health")
def health():
    return {"ok": True, "model_loaded": os.path.exists(MODEL_PATH)}

@app.get("/monitoring-settings")
def get_monitoring_settings():
    return monitoring_settings.model_dump()

@app.post("/monitoring-settings")
def update_monitoring_settings(settings: MonitoringSettings):
    global monitoring_settings
    monitoring_settings = settings
    return {"message": "Settings updated successfully", "settings": monitoring_settings.model_dump()}

@app.post("/infer")
async def infer_image(file: UploadFile = File(...), elderly_id: str = Form(...)):
    content = await file.read()
    pil_img = Image.open(io.BytesIO(content)).convert("RGB")

    boxes = run_inference(pil_img)
    print("Detected boxes:", boxes)
    print("Received file:", file.filename)

    fall_count = sum(1 for b in boxes if b.cls == "fall")
    person_count = sum(1 for b in boxes if b.cls == "person")
    total_frames = 1 
    status = "fall" if fall_count > 0 else "person" if person_count > 0 else "none"

    draw = ImageDraw.Draw(pil_img)
    for b in boxes:
        draw.rectangle(
            [(b.x1, b.y1), (b.x2, b.y2)],
            outline="red",
            width=3
        )
        draw.text((b.x1, max(b.y1 - 10, 0)), f"{b.cls} {b.conf:.2f}", fill="red")

    buffered = io.BytesIO()
    pil_img.save(buffered, format="JPEG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

    boxes_serializable = [b.model_dump() for b in boxes]

    doc = DetectResult(
        timestamp=datetime.utcnow().isoformat(),
        source="upload",
        status=status,
        fall_count=fall_count,
        person_count=person_count,
        total_frames=total_frames,
        boxes=boxes_serializable,
    )

    save_detection(doc)

    send_to_node(
        elderly_id=elderly_id,
        status=status,
        frame_count=total_frames,
        falls_in_frame=fall_count,
        image_base64=img_str,
    )

    return {
        "result": doc.model_dump(),
        "image_b64": img_str
    }

NODE_API_URL = "http://localhost:5000/api/falls"

def send_to_node(elderly_id, status, frame_count, falls_in_frame, image_base64=None):
    try:
        payload = {
            "elderlyId": elderly_id,
            "status": status,
            "frameCount": frame_count,
            "fallsInFrame": falls_in_frame,
        }


        if image_base64:
            payload["imageBase64"] = image_base64

        res = requests.post(NODE_API_URL, json=payload)
    except Exception as e:
        print("Failed to send to Node.js:", e)

class WSMessage(BaseModel):
    frame_b64: str
    client_id: str


@app.websocket("/ws")
async def ws_detect(websocket: WebSocket):
    await websocket.accept()

    frame_counter = 0
    status_counter = Counter()
    last_image_b64 = None  


    last_person_box = None
    last_person_time = None
    
    last_detection_time = datetime.utcnow()  
    no_person_alert_sent = False 

    try:
        while True:
            msg = await websocket.receive_text()

            if msg.startswith("{"):
                data = json.loads(msg)
                elderly_id = data.get("elderlyId")
                frame_b64 = data.get("frame_b64", "")
                client_id = data.get("client_id", "unknown")
            else:
                frame_b64 = msg
                elderly_id = None
                client_id = "unknown"

            try:
                if frame_b64.startswith("data:image"):
                    frame_b64 = frame_b64.split(",", 1)[1]
                img_bytes = base64.b64decode(frame_b64)
                pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                last_image_b64 = frame_b64  
            except Exception as e:
                print("Failed to decode image:", e)
                continue


            boxes = run_inference(pil_img)
            boxes_serializable = [b.model_dump() for b in boxes]

            falls = sum(1 for b in boxes if b.cls == "fall")
            persons = [b for b in boxes if b.cls == "person"]

            if falls > 0 or persons:
                last_detection_time = datetime.utcnow()
                no_person_alert_sent = False  

            if falls > 0:
                status_counter["fall"] += 1
            elif persons:
                status_counter["person"] += 1
            else:
                status_counter["-"] += 1

            frame_counter += 1  

            await websocket.send_json({
                "boxes": boxes_serializable,
                "fallsInFrame": falls,
                "personsInFrame": len(persons)
            })

            # inactivity detection
            detected_objects = persons + [b for b in boxes if b.cls == "fall"]

            if detected_objects:
                first_object = detected_objects[0]
                current_box = (first_object.x1, first_object.y1, first_object.x2, first_object.y2) 
                current_time = datetime.utcnow()
                
                if last_person_box is None:
                    last_person_box = current_box
                    last_person_time = current_time
                else:
                    dist = sum(abs(c1 - c2) for c1, c2 in zip(current_box, last_person_box))
                    movement_threshold = 50

                    if dist < movement_threshold:
                        inactivity_duration = (current_time - last_person_time).total_seconds()
                        if inactivity_duration >= monitoring_settings.inactivity_threshold:
                            object_type = "person" if persons else "fall"
                            print(f"inactivity detected for {object_type}")
                            
                            doc = DetectResult(
                                timestamp=current_time.isoformat(),
                                source=f"webcam:{client_id}",
                                status=f"inactivity_{object_type}", 
                                fall_count=status_counter["fall"],
                                person_count=status_counter["person"],
                                total_frames=frame_counter
                            )
                            collection.insert_one(doc.model_dump())

                            send_to_node(
                                elderly_id=elderly_id,
                                status=f"inactivity_{object_type}",
                                frame_count=doc.total_frames,
                                falls_in_frame=doc.fall_count,
                                image_base64=last_image_b64 if last_image_b64 else ""
                            )

                            print(f"⚠️ {object_type.capitalize()} inactivity detected for {inactivity_duration:.1f} seconds:", doc.model_dump())
                            
                            last_person_time = current_time
                    else:
                        last_person_box = current_box
                        last_person_time = current_time
            else:
                last_person_box = None
                last_person_time = None
            # No Person Detection during Monitoring Hours
            current_time = datetime.utcnow()
            time_since_last_detection = (current_time - last_detection_time).total_seconds()
            
            current_hour = current_time.hour
            current_minute = current_time.minute
            monitoring_start_hour = monitoring_settings.monitoring_start_hour
            monitoring_end_hour = monitoring_settings.monitoring_end_hour
            
            is_monitoring_time = (
                (current_hour == monitoring_start_hour and current_minute >= 0) or
                (current_hour > monitoring_start_hour and current_hour < monitoring_end_hour) or
                (current_hour == monitoring_end_hour and current_minute == 0)
            )
            
            if (time_since_last_detection >= monitoring_settings.no_person_threshold and 
                not no_person_alert_sent and 
                is_monitoring_time):
 
                doc = DetectResult(
                    timestamp=current_time.isoformat(),
                    source=f"webcam:{client_id}",
                    status="noperson",
                    fall_count=status_counter["fall"],
                    person_count=status_counter["person"],
                    total_frames=frame_counter
                )
                collection.insert_one(doc.model_dump())

                send_to_node(
                    elderly_id=elderly_id,
                    status="noperson",
                    frame_count=doc.total_frames,
                    falls_in_frame=doc.fall_count,
                    image_base64=last_image_b64 if last_image_b64 else ""
                )

                no_person_alert_sent = True  
                
            if frame_counter >= 10:
                status = "-"
                if status_counter["fall"] >= 5:
                    status = "fall"
                elif status_counter["person"] >= 5:
                    status = "person"

                doc = DetectResult(
                    timestamp=datetime.utcnow().isoformat(),
                    source=f"webcam:{client_id}",
                    status=status,
                    fall_count=status_counter["fall"],
                    person_count=status_counter["person"],
                    total_frames=frame_counter
                )

                collection.insert_one(doc.model_dump())

                send_to_node(
                    elderly_id=elderly_id,
                    status=doc.status,
                    frame_count=doc.total_frames,
                    falls_in_frame=doc.fall_count,
                    image_base64=last_image_b64 if last_image_b64 else ""    
                )

                frame_counter = 0
                status_counter.clear()

    except WebSocketDisconnect:
        print("WebSocket disconnected")

    
@app.get("/detections")
def list_detections(limit: int = 50, source: Optional[str] = None):
    q = {}
    if source:
        q["source"] = source
    items = list(detections_col.find(q).sort([("_id", -1)]).limit(limit))
    for i in items:
        i["_id"] = str(i["_id"])
    return items
