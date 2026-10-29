# Security Motion Capture PWA

A Progressive Web App for monitoring a selected camera and microphone, detecting visual motion, and saving event clips with a rolling pre-roll buffer.

## Behavior

- Camera and microphone permission is requested when you click **Start Monitoring**.
- The camera preview and camera chooser are available on the main screen. After permission is granted, the chooser displays camera names reported by the device, including front and rear labels where available.
- When motion is detected, the app saves approximately the five seconds before the trigger, continues through the motion, and includes five seconds after motion stops.
- If you click **Stop Monitoring** during an active event, the app immediately closes and saves that event.
- Captures are named `Capture_YYYY-MM-DD_HH-mm-ss.ext`. The app prefers MP4 when the browser supports it and uses the matching `.webm` extension when the browser records WebM.
- Debug logs are named `Log_YYYY-MM-DD_HH-mm-ss.txt`. Logging stops when monitoring stops.

## Saving

### Windows

The local HTTPS server creates `C:\Abyss\PWA_Captures` and `C:\Abyss\PWALogs` and saves captures and logs there. If you host the PWA elsewhere, use **Link C:\Abyss Folder for Direct Saving** once and select `C:\Abyss`; the browser then writes into the two subfolders. If direct saving is unavailable, captures and logs download through the browser.

### Automatic iPhone-to-PC saving

For automatic saves with no per-video tap, run the local HTTPS server on the Windows PC and open/install the PWA from the HTTPS address it prints. Keep the PC server running and the iPhone on the same Wi-Fi. The app detects the server, selects **Home PC: Auto-save to C:\Abyss\PWA_Captures**, and posts each finished clip to that PC. If the PC is offline, clips stay in the app's IndexedDB gallery and are retried automatically when the server is reachable again. The **PC Sync** status shows how many clips are waiting. Session logs go to the PC when it is reachable; otherwise use the debug log panel to copy or download them. The video files are already on the laptop and can be copied to another computer or USB drive from that folder.

### iPhone

When the PWA is served by the local PC server, it can automatically send captures to that PC as described above. Otherwise, the app keeps captures in its in-app gallery and offers a **Save Video** action. Tapping it opens the iOS Share Sheet; choose Photos, OneDrive, or Google Drive. For Google Drive, choose or create the `MyCaptures` folder in Drive. Automatic folder creation would need Google OAuth and Drive API setup; this app currently uses the iOS Share Sheet instead. Offline gallery files are private to this PWA's browser storage; they do not appear as a regular folder in Files or over USB, and clearing Safari/site data can remove them.

The camera chooser offers explicit **Rear Camera** and **Front Camera** options on iPhone and Android. The app requests the selected facing mode directly, rather than depending on iOS to expose both cameras as separate device IDs.

Use **View / Copy Debug Log** to copy the current or most recent session log. On Windows, the local server writes each session log to `C:\Abyss\PWALogs`.

## Run locally over HTTPS

Camera and microphone access require a secure context. From this folder, run:

```powershell
py -3 -m pip install -r requirements.txt
py -3 serve_https.py
```

Or double-click `start_server.bat`. Open the HTTPS address printed by the server. For iPhone testing, the phone and PC must be on the same Wi-Fi network and the iPhone must accept the local development certificate. Add the page to the Home Screen from Safari to run it in standalone mode.

The local server requires Python 3 and the `cryptography` package to generate a development certificate when one is not already present. It creates the output folders at startup and serves this directory over HTTPS on port 8443.
