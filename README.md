
# Smart Camera Monitoring & Detection System

## Overview

This module is part of an elderly safety monitoring system that uses a camera feed to capture real-time images, process visual data, and perform intelligent analysis to detect potential safety risks such as falls, prolonged inactivity, and absence from a monitored area.

The system is designed to support independent living for elderly users by providing continuous, automated monitoring and timely alerts to caregivers.

## Key Features

### 1. Image Capture

* Captures live video stream from camera devices
* Extracts frames at defined intervals for processing
* Ensures low-latency data acquisition for real-time analysis

### 2. Image Processing Pipeline

* Preprocesses frames 
* Prepares input data for detection models
* Optimized for performance and real-time inference

### 3. Fall Detection

* Detects abnormal body posture and sudden movement changes
* Triggers alert when a fall-like event is identified
* Reduces false positives using temporal validation

### 4. Absence Detection

* Monitors whether a person is present in the defined area
* Triggers alert if no person is detected for a prolonged period
* Helps ensure safety during unattended situations

### 5. Prolonged Activity Monitoring

* Tracks continuous inactivity or unusual static posture
* Identifies potential risk situations such as immobility
* Sends warning notifications if thresholds are exceeded

### 6. Backend Logic & Alert System

* Processes detection results in the backend server
* Applies rules-based logic for decision making
* Sends alerts to caregivers via notification system (e.g., dashboard, messaging, or API)

## Technology Stack

* Python
* YOLOv8
* Flask 

## System Flow

Camera → Frame Capture → Preprocessing → Detection Model → Backend Logic → Alert System

## Future Improvements
* Integrate with real camera

## Screesnshots
Camera 
<img width="967" height="464" alt="image" src="https://github.com/user-attachments/assets/ed9986e6-0703-4620-a107-1bc9d0ce193d" />
Settings
<img width="955" height="800" alt="image" src="https://github.com/user-attachments/assets/84f85a37-00b6-4c8f-a444-9cf7b7a7f640" />
