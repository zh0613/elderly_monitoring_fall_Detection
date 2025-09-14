import { useState, useEffect, useRef, type ChangeEvent } from "react";

  interface DetectionBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    conf: number;
    cls: string;
  }

  interface DetectionResult {
    timestamp: string;
    source: string;
    fall_count: number;
    boxes: DetectionBox[];
    image_url?: string;
    person_count: number;
    status: "people" | "fall" | "none";
  }

  interface Elderly {
    _id: string;
    userId: UserId;
  }

  interface UserId {
    fullname: string;
    email: string;
  }

  interface MonitoringSettings {
    monitoring_start_hour: number;
    monitoring_end_hour: number;
    inactivity_threshold: number;
    no_person_threshold: number;
  }


export default function App() {
  const [activeTab, setActiveTab] = useState<"camera" | "upload" | "settings">("camera");
  const [falls, setFalls] = useState<number>(0);
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [file, setFile] = useState<File>();
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [elderlyList, setElderlyList] = useState<Elderly[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [image, setImage] = useState(null);
  const [settings, setSettings] = useState<MonitoringSettings>({
    monitoring_start_hour: 6,
    monitoring_end_hour: 7,
    inactivity_threshold: 10,
    no_person_threshold: 5,
  });


useEffect(() => {
  const ws = new WebSocket("ws://localhost:8000/ws");

  let interval: number;

  ws.onopen = () => {
    interval = window.setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;

      if (cameraOn && selectedId) {
        const frame_b64 = canvasRef.current.toDataURL("image/jpeg", 0.5);

        ws.send(
          JSON.stringify({
            elderlyId: selectedId,   
            client_id: "frontend-user-123",
            frame_b64
          })
        );
      }
    }, 1000); 
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.boxes) {
        setBoxes(data.boxes);
      }
    } catch (err) {
      console.error("Failed to parse WS message", err);
    }
  };

  return () => {
    clearInterval(interval);
    ws.close();
  };
}, [cameraOn, selectedId]);


  useEffect(() => {
    const draw = () => {
      if (!videoRef.current || !canvasRef.current) {
        requestAnimationFrame(draw);
        return;
      }

      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) {
        requestAnimationFrame(draw);
        return;
      }

      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;

      ctx.drawImage(videoRef.current, 0, 0);

      boxes.forEach(({ x1, y1, x2, y2, conf, cls }) => {
        ctx.strokeStyle = cls === "fall" ? "red" : "lime";
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.fillStyle = cls === "fall" ? "red" : "lime";
        ctx.font = "16px Arial";
        ctx.fillText(`${cls} (${(conf * 100).toFixed(1)}%)`, x1 + 5, y1 - 5);
      });

      requestAnimationFrame(draw);
    };

    draw();
  }, [boxes]);

  useEffect(() => {
    fetch("http://localhost:5000/api/users/elderly")
      .then(res => res.json())
      .then(data => {
        console.log("Elderly List:", data);
        setElderlyList(data);
      })
      .catch(err => console.error("Error fetching elderly:", err));
  }, []);

  useEffect(() => {
    fetch("http://localhost:8000/monitoring-settings")
      .then(res => res.json())
      .then(data => {
        console.log("Monitoring Settings:", data);
        setSettings(data);
      })
      .catch(err => console.error("Error fetching settings:", err));
  }, []);

  const handleChange = (e:any) => {
    const id = e.target.value;
    setSelectedId(id);
  };

  const saveSettings = async () => {
    try {
      const res = await fetch("http://localhost:8000/monitoring-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        throw new Error("Failed to save settings");
      }

      const data = await res.json();
      console.log("Settings saved:", data);
      alert("Settings saved successfully!");
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings. See console for details.");
    }
  };

  const handleUpload = async (e: any) => {
  e.preventDefault();

  if (!file) {
    alert("Please select a file first");
    return;
  }

  if (!selectedId) {
    alert("Please select an elderly before uploading");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("elderly_id", selectedId);

  try {
    const res = await fetch("http://localhost:8000/infer", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error("Failed to upload file");
    }

    const data = await res.json();
    setResult(data.result);
    setImage(data.image_b64);
  } catch (err) {
    console.error("Upload failed:", err);
    alert("Detection failed. See console for details.");
  }
};

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setFileName(selectedFile.name); 
    }
  };

    const startCamera = async () => {
      if (!videoRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCameraOn(true);
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    };

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setCameraOn(false);
    };

  
return (

  <div className="flex  items-center justify-center">
    <div className="font-sans p-6 w-full max-w-xl">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Fall Detection Camera
      </h1>

      <div className="flex gap-2 mb-6 justify-center">
        <button
          className={`px-4 py-2 border rounded ${
            activeTab === "camera" ? "bg-gray-200" : ""
          }`}
          onClick={() => setActiveTab("camera")}
        >
          📷 Camera Detection
        </button>
        <button
          className={`px-4 py-2 border rounded ${
            activeTab === "upload" ? "bg-gray-200" : ""
          }`}
          onClick={() => setActiveTab("upload")}
        >
          📂 Upload Image
        </button>
        <button
          className={`px-4 py-2 border rounded ${
            activeTab === "settings" ? "bg-gray-200" : ""
          }`}
          onClick={() => setActiveTab("settings")}
        >
          ⚙️ Settings
        </button>
      </div>

      <div>
      <label className="block mb-2 font-medium">Select Elderly</label>
      <select
        value={selectedId}
        onChange={handleChange}
        className="border rounded p-2 w-full mb-4"
      >
        <option value="" className="text-black">-- Choose an Elderly --</option>
        {elderlyList.map((elderly) => (
          <option key={elderly._id} value={elderly._id} className="text-black">
            {elderly.userId.fullname} ({elderly.userId.email})
          </option>
        ))}
      </select>
    </div>

      {activeTab === "camera" && (
        <div className="flex flex-col items-center">
          <div className="relative w-96">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-96 border"
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-96 h-auto"
          />
          </div>
          <button
            onClick={() => (cameraOn ? stopCamera() : startCamera())}
            className="mt-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded shadow-md transition-colors"
          >
            {cameraOn ? "Stop Camera" : "Start Camera"}
          </button>
          <p className="mt-2">
            Status: {boxes.length > 0 ? boxes.map((b) => b.cls).join(", ") : "-"}
          </p>
        </div>
      )}

  
      {activeTab === "upload" && (
        <form onSubmit={handleUpload} className="flex flex-col items-center">
          <input
            type="file"
            id="fileInput"
            className="hidden"
            onChange={handleFileChange}
          />

          <label
            htmlFor="fileInput"
            className="cursor-pointer px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-md transition-colors duration-200"
          >
            Choose File
          </label>
          <p className="mt-2 mb-3 text-white text-sm">
            {fileName || "No file selected"}
          </p>

          <button
            type="submit"
            className="px-4 py-2 border rounded bg-blue-500 text-white"
          >
            Detect
          </button>

          <p className="mt-2">
            Falls detected: {result && result.fall_count > 0 ? "Yes" : "No"}
          </p>

          {result && (
            <div className="mt-6 p-4 border rounded shadow">
              <h2 className="text-lg font-bold mb-2">Detection Result</h2>
              <p>
                <strong>Timestamp:</strong> {result.timestamp}
              </p>
              <p>
                <strong>Falls detected:</strong> {result.fall_count}
              </p>
              <p>
                <strong>Persons detected:</strong> {result.person_count}
              </p>
              <p>
                <strong>Status:</strong> {result.status}
              </p>

              {result.boxes && result.boxes.length > 0 && (
                <div>
                  <h3 className="font-semibold mt-2">Boxes:</h3>
                  <ul className="list-disc ml-6">
                    {result.boxes.map((b, i) => (
                      <li key={i}>
                        x1: {b.x1}, y1: {b.y1}, x2: {b.x2}, y2: {b.y2},{" "}
                        conf: {b.conf.toFixed(2)}, cls: {b.cls}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {image && (
                <div className="mt-3">
                  <h3 className="font-semibold">Image:</h3>
                  <img
                    src={`data:image/jpeg;base64,${image}`}
                    alt="Detection result"
                    className="max-w-full h-auto border rounded"
                  />
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {activeTab === "settings" && (
        <div className="flex flex-col items-center">
          <h2 className="text-xl font-bold mb-4">Monitoring Settings</h2>
          
          <div className="w-full max-w-md space-y-4">
            <div>
              <label className="block mb-2 font-medium">Monitoring Start Hour (0-23):</label>
              <input
                type="number"
                min="0"
                max="23"
                value={settings.monitoring_start_hour}
                onChange={(e) => setSettings({
                  ...settings,
                  monitoring_start_hour: parseInt(e.target.value)
                })}
                className="border rounded p-2 w-full"
              />
            </div>

            <div>
              <label className="block mb-2 font-medium">Monitoring End Hour (0-23):</label>
              <input
                type="number"
                min="0"
                max="23"
                value={settings.monitoring_end_hour}
                onChange={(e) => setSettings({
                  ...settings,
                  monitoring_end_hour: parseInt(e.target.value)
                })}
                className="border rounded p-2 w-full"
              />
            </div>

            <div>
              <label className="block mb-2 font-medium">Inactivity Threshold (seconds):</label>
              <input
                type="number"
                min="1"
                value={settings.inactivity_threshold}
                onChange={(e) => setSettings({
                  ...settings,
                  inactivity_threshold: parseInt(e.target.value)
                })}
                className="border rounded p-2 w-full"
              />
            </div>

            <div>
              <label className="block mb-2 font-medium">No Person Threshold (seconds):</label>
              <input
                type="number"
                min="1"
                value={settings.no_person_threshold}
                onChange={(e) => setSettings({
                  ...settings,
                  no_person_threshold: parseInt(e.target.value)
                })}
                className="border rounded p-2 w-full"
              />
            </div>

            <button
              onClick={saveSettings}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 w-full"
            >
              Save Settings
            </button>

            <div className="text-sm text-gray-600 mt-4">
              <p><strong>Current Settings:</strong></p>
              <p>Monitoring Time: {settings.monitoring_start_hour}:00 - {settings.monitoring_end_hour}:00</p>
              <p>Inactivity Alert: {settings.inactivity_threshold} seconds</p>
              <p>No Person Alert: {settings.no_person_threshold} seconds</p>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>

);
}


