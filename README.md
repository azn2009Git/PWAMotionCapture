# Security Motion Capture PWA

A Progressive Web App (PWA) designed to run on **Apple iPhone (iOS Safari)** and **Windows / Laptops** as a security monitoring system with audio/video recording, real-time motion detection, and automated 5-second pre-roll / post-roll event capture.

---

## 🌟 Key Features

1. **Top Viewfinder HUD (Requirement 1 & 2)**:
   - Live camera frame showing what the camera sees.
   - Real-time Motion Activity Level meter (0% to 100%) and trigger threshold marker.
   - Armed status banner and real-time clock.
2. **Device & Camera Selection (Requirement 3)**:
   - Front vs Rear facing camera selector on Apple iPhones & Android.
   - Dropdown of all available video hardware on Windows laptops and PCs.
3. **5-Second Pre-Roll & 5-Second Post-Roll (Requirement 1)**:
   - Continuously buffers video and audio before motion occurs.
   - When motion is tripped, saves the **previous 5 seconds** of audio and video.
   - Continues recording during the entire motion event.
   - Keeps recording for **5 seconds after motion ceases** before closing the file.
4. **Strict Filename Formats (Requirement 1 & 4)**:
   - Video Captures: `Capture_YYYY-MM-DD_HH-mm-ss.mp4`  
     *(e.g., `Capture_2026-10-29_13-02-57.mp4`)*
   - Debug Logs: `Log_YYYY-MM-DD_HH-mm-ss.txt`  
     *(e.g., `Log_2026-10-29_15-01-56.txt`)*
5. **Storage Routing (Requirement 1 & 4)**:
   - **Windows**: Automatically creates and saves into `C:\Abyss\PWA_Captures` (videos) and `C:\Abyss\PWALogs` (debug logs).
   - **Apple iPhone**: Defaults to saving into the **Camera Roll (Photos App)** via native iOS Share Sheet, or allows selecting **OneDrive / Files App** from the destination dropdown.
6. **Session Debug Logging & One-Click Copy (Requirement 4)**:
   - A fresh log file is created each time "Start Monitoring" is clicked.
   - Logging automatically stops when "Stop Monitoring" is clicked.
   - **"📋 View / Copy Debug Log"** button opens a modal to view and copy the log directly to clipboard to send for debugging.
7. **Close App Button (Requirement 5)**:
   - Safely releases camera and microphone hardware tracks and closes the window.

---

## 📱 How to Run & Test

### Option 1: Local HTTPS Server (Instant Wi-Fi iPhone Testing)
1. Double-click `start_server.bat` or run:
   ```powershell
   cd C:\Abyss\PWAMotionCapture
   python serve_https.py
   ```
2. On your iPhone, open Safari and navigate to your Wi-Fi IP (e.g. `https://192.168.1.53:8443/`).
3. Tap **"Show Details"** &rarr; **"visit this website"** to accept the local certificate.
4. Tap Safari's **Share** button &rarr; **"Add to Home Screen"** &rarr; **"Add"**.
5. Open the app from your home screen.

### Option 2: Upload to GitHub Pages
To publish changes to your repository:
```powershell
cd C:\Abyss\PWAMotionCapture
git add .
git commit -m "Implement Security Motion Capture with 5s pre/post roll and logging"
git push origin main
```
Your GitHub Pages URL will update at:
`https://azn2009git.github.io/PWAMotionCapture/`
