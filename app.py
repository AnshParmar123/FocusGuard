import cv2
from ultralytics import YOLO
import pygame
import time
import os

# --- CONFIGURATION ---
AUDIO_FILE = "audio.mp3"  
CONFIDENCE_LEVEL = 0.5    
COOLDOWN_SECONDS = 11     
FRAME_SKIP = 3  # Har 3rd frame hi check karega (Speed badhane ke liye)
# ---------------------

if not os.path.exists(AUDIO_FILE):
    print(f"ERROR: '{AUDIO_FILE}' file nahi mili!")
    exit()

# Audio pehle hi load kar lo (Loop ke bahar) - Ye fast karega
pygame.mixer.init()
try:
    pygame.mixer.music.load(AUDIO_FILE)
except Exception as e:
    print(f"Audio Error: {e}")

print("Loading Fast AI Model...")
model = YOLO('yolov8n.pt')

cap = cv2.VideoCapture(0)

# Resolution High rakhna hai
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1024)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 768)

last_alert_time = 0
frame_count = 0
phone_detected = False # State save karne ke liye
boxes_to_draw = [] # Boxes save karne ke liye

print("System Ready. Press 'q' to exit.")

while True:
    ret, frame = cap.read()
    if not ret:
        break
    
    frame_count += 1

    # --- SPEED TRICK: FRAME SKIPPING ---
    # Sirf har 'FRAME_SKIP' frame par hi AI run karega
    # Baaki time purana result dikhayega (Video smooth rahegi)
    if frame_count % FRAME_SKIP == 0:
        # imgsz=640 se processing fast hogi bhale hi camera 1024 ho
        results = model(frame, stream=True, verbose=False, conf=CONFIDENCE_LEVEL, imgsz=640)
        
        phone_detected = False
        boxes_to_draw = [] # List clear karo

        for r in results:
            boxes = r.boxes
            for box in boxes:
                cls_id = int(box.cls[0])
                class_name = model.names[cls_id]

                if class_name == 'cell phone':
                    phone_detected = True
                    # Coordinates save kar lo draw karne ke liye
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    boxes_to_draw.append((x1, y1, x2, y2))
    
    # --- DRAWING (Har frame pe draw karo taaki flicker na ho) ---
    if phone_detected:
        for (x1, y1, x2, y2) in boxes_to_draw:
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
            cv2.putText(frame, "PHONE RAKHHHH NEECHE!", (x1, y1 - 10), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

        # Audio Logic
        current_time = time.time()
        if current_time - last_alert_time > COOLDOWN_SECONDS:
            print(">>> ALERT: Fast Detection!")
            if not pygame.mixer.music.get_busy():
                pygame.mixer.music.play()
            last_alert_time = current_time

    cv2.imshow('No Phone Zone', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()









