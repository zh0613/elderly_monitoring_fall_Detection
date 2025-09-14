import requests
import json

# FastAPI endpoint
url = "http://127.0.0.1:8000/infer"

# Path to your test image
image_path = r"D:\downloads\falling\360_F_313082223_HEofzWR1LRslBxZRYLuD1qnc53OnsqMz.jpg"

# Prepare multipart form data
files = {"file": open(image_path, "rb")}
data = {"elderly_id": "68b1cb6bfc25336d2c8a27be"}

print(f"Sending {image_path} to {url}...")

# Send POST request
response = requests.post(url, files=files, data=data)

# Print response
print("Status Code:", response.status_code)
try:
    print("Response JSON:")
    print(json.dumps(response.json(), indent=2))
except Exception:
    print("Raw Response Text:")
    print(response.text)
