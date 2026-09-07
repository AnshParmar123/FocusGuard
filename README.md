# FocusGuard

FocusGuard is a browser-based AI monitoring app built for focus sessions, classrooms, libraries, study rooms, desks, and any other zone you want watched.

It opens your webcam, watches for a condition you choose in real time using AI in the browser, and triggers a siren followed by a custom alert audio whenever that condition is met.

## Highlights

- Clean premium UI built with plain HTML, CSS, and JavaScript
- Real-time object detection in the browser using TensorFlow.js and COCO-SSD
- Four selectable **guard profiles** so the same app covers multiple use cases:
  - **Phone-Free Zone** — alerts when a phone appears in frame
  - **Presence Guard** — alerts when you leave the frame (front camera recommended)
  - **Intruder Alert** — alerts when a second person enters the frame
  - **Custom Object** — type any object the AI model recognizes and watch for it
- Settings drawer with live sensitivity, alert-cooldown, alert-sound (siren+audio / siren only / silent), and front/back camera controls — all persisted to `localStorage`
- Session stats: session time, alerts triggered, and longest clean streak
- Live bounding boxes drawn over the camera feed
- Alert flow with a siren sound, optional `audio.mp3` follow-up, and mobile vibration on supported devices
- Mobile-friendly layout: bottom-sheet settings drawer, safe-area padding for notches, touch-sized controls, and an adaptive camera viewport
- Static-site friendly setup that works well with Vercel

## How It Works

The app runs fully on the client side.

1. The user opens the website, optionally picks a guard profile and settings in the gear-icon drawer, then clicks `Start Camera`.
2. The browser asks for camera permission.
3. The app loads the COCO-SSD model through TensorFlow.js.
4. The live camera feed is scanned continuously for whatever the active guard profile is watching for.
5. When the profile's alert condition is met:
   - a bounding box is drawn on screen (where applicable)
   - a short siren sound plays first
   - the main alert audio from `audio.mp3` plays immediately after (unless a different alert-sound mode is selected)
   - the device vibrates briefly, if supported
6. If a later detection happens after the cooldown window, the alert sequence starts again from the beginning.

## Tech Stack

- HTML
- CSS
- JavaScript
- TensorFlow.js
- COCO-SSD object detection model

## Project Structure

```text
.
├── README.md
├── index.html
├── styles.css
├── webapp.js
├── audio.mp3
├── app.py
└── yolov8n.pt
```

## Main Files

- `index.html`
  The app structure, camera container, overlay canvas, and audio element.

- `styles.css`
  All visual styling, layout, responsive behavior, and the premium color system.

- `webapp.js`
  Camera access, model loading, detection loop, overlay drawing, siren playback, and alert audio sequence.

- `audio.mp3`
  The custom alert sound played after the siren.

- `app.py`
  Your original Python-based local version. It is kept in the project for reference but is not used by the deployed web app.

- `yolov8n.pt`
  The YOLO model file from the original Python implementation. It is not used by the browser app.

## How To Run Locally

Because this is a browser app, do not open `index.html` directly by double-clicking it. Run it through a local server.

### Option 1: Python

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

### Option 2: VS Code Live Server

If you use VS Code, you can run the folder with the Live Server extension and open the generated local URL.

## How To Use

1. Start the local server.
2. Open the app in your browser.
3. Click `Start Camera`.
4. Allow webcam permission when the browser asks.
5. Point the camera at a phone.
6. When the phone is detected, the app will show the detection box and play the alert sequence.

## Browser Notes

- Camera access usually works only on `localhost` or `HTTPS`.
- On deployed Vercel URLs, camera access will work because Vercel serves the site over HTTPS.
- Browsers may block autoplayed audio unless the user interacts first, which is why the app arms the audio when `Start Camera` is clicked.

## Deploying To Vercel

This project is a static frontend, so deployment is simple.

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Keep the framework preset as `Other` or let Vercel auto-detect it as a static site.
4. Deploy.

No backend or build step is required.

## Current Detection Behavior

- The active guard profile determines what the COCO-SSD model looks for (`cell phone`/`remote` for Phone-Free Zone, `person` for Presence Guard and Intruder Alert, or any class name typed into Custom Object).
- Detection happens repeatedly on the live video feed, smoothed over a few frames in both directions so brief flickers don't cause false alarms or premature "all clear" states.
- The alert sequence is rate-limited with a configurable cooldown (default 3s) so it does not spam continuously every frame.
- If a fresh alert condition is met after the cooldown, the siren and main audio restart from the beginning.

## Limitations

- The browser version uses COCO-SSD, not your original YOLO Python pipeline, so detection quality may differ.
- Browser-based detection depends on the user device, camera quality, and available performance.
- Very small, blurry, or partially hidden phones may be harder to detect.

## Original Python Version

This project started as a Python + OpenCV + YOLO phone detection setup. That original version is still included in `app.py`, but the main product is now the browser version because it is much easier for other people to use and much easier to deploy on Vercel.

## Author

Made with ❤️ by Ansh Parmar
