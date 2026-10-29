/**
 * Security Motion Capture PWA
 * - 5-Second Pre-Roll & 5-Second Post-Roll Audio/Video Engine
 * - Motion Frame Differencing & Live Viewfinder HUD
 * - Windows (C:\Abyss\PWA_Captures & C:\Abyss\PWALogs) & iPhone Camera Roll / OneDrive support
 * - Session Debug Logging & On-Screen Copying
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const PRE_ROLL_SEC = 5;
  const POST_ROLL_SEC = 5;
  const BUFFER_ROTATION_INTERVAL_MS = 5000;
  const MOTION_CHECK_INTERVAL_MS = 80; // ~12 fps motion check

  // --- State Variables ---
  let isMonitoring = false;
  let isRecordingMotion = false;
  let postRollCountdownTimer = null;
  let postRollRemainingSec = 0;

  let currentCameraStream = null;
  let selectedDeviceId = '';
  let availableCameras = [];

  // Ping-Pong Staggered Buffers for Continuous Pre-Roll
  let recorderA = null;
  let recorderB = null;
  let chunksA = [];
  let chunksB = [];
  let startTimeA = 0;
  let startTimeB = 0;
  let bufferRotationTimer = null;
  let activeEventRecorder = null; // Either 'A' or 'B' when motion trips
  let activeEventDate = null;
  let activeFinalizationPromise = null;

  // Motion Detection
  let motionThreshold = 15; // default 15%
  let prevFrameData = null;
  let motionAnalysisInterval = null;
  let currentMotionPercent = 0;

  // Session Debug Log
  let currentLogFilename = '';
  let currentLogEntries = [];
  let logSessionActive = false;

  // Platform & Server
  let isWindows = false;
  let isIOS = false;
  let isMobileCameraDevice = false;
  let isLocalServerAvailable = false;
  let abyssDirHandle = null;
  let totalCapturesCount = 0;

  // Windows Directory Handle Elements
  const windowsFolderSetupWrap = document.getElementById('windowsFolderSetupWrap');
  const linkAbyssFolderBtn = document.getElementById('linkAbyssFolderBtn');
  const windowsFolderStatusText = document.getElementById('windowsFolderStatusText');

  // iOS Install & Toast Elements
  const iosInstallStrip = document.getElementById('iosInstallStrip');
  const showInstallGuideBtn = document.getElementById('showInstallGuideBtn');
  const installGuideModal = document.getElementById('installGuideModal');
  const closeInstallGuideBtn = document.getElementById('closeInstallGuideBtn');
  const dismissGuideOkBtn = document.getElementById('dismissGuideOkBtn');

  const captureToast = document.getElementById('captureToast');
  const toastTitle = document.getElementById('toastTitle');
  const toastSubtitle = document.getElementById('toastSubtitle');
  const toastActionBtn = document.getElementById('toastActionBtn');
  const toastCloseBtn = document.getElementById('toastCloseBtn');
  let toastTimer = null;

  // --- IndexedDB for Persistent Folder Handle & Captured Videos ---
  function getDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('SecurityCamDB', 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
        if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures', { keyPath: 'filename' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveCaptureToDB(record) {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('captures', 'readwrite');
        tx.objectStore('captures').put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {
      console.warn('IndexedDB save failed:', e);
    }
  }

  async function loadAllCapturesFromDB() {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('captures', 'readonly');
        const req = tx.objectStore('captures').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
  }

  async function deleteCaptureFromDB(filename) {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('captures', 'readwrite');
        tx.objectStore('captures').delete(filename);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (e) {}
  }

  function showCaptureToast(blob, filename) {
    if (!captureToast) return;
    toastTitle.textContent = 'Capture Complete!';
    const saveHint = destinationSelect.value === 'googledrive'
      ? 'Tap Save Video, then choose Google Drive and MyCaptures (create it if needed)'
      : 'Tap Save Video to choose a destination';
    toastSubtitle.textContent = `${(blob.size / 1024 / 1024).toFixed(1)} MB • ${saveHint}`;

    toastActionBtn.onclick = () => {
      triggerSystemShare(blob, filename);
      captureToast.classList.remove('show');
    };

    captureToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      captureToast.classList.remove('show');
    }, 7000);
  }

  if (toastCloseBtn && captureToast) {
    toastCloseBtn.addEventListener('click', () => {
      captureToast.classList.remove('show');
    });
  }

  if (showInstallGuideBtn && installGuideModal) {
    showInstallGuideBtn.addEventListener('click', () => {
      installGuideModal.classList.add('open');
    });
  }
  if (closeInstallGuideBtn && installGuideModal) {
    closeInstallGuideBtn.addEventListener('click', () => {
      installGuideModal.classList.remove('open');
    });
  }
  if (dismissGuideOkBtn && installGuideModal) {
    dismissGuideOkBtn.addEventListener('click', () => {
      installGuideModal.classList.remove('open');
    });
  }

  async function saveDirectoryHandle(handle) {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'abyss_dir');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('Could not persist directory handle in DB:', e);
    }
  }

  async function loadDirectoryHandle() {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('abyss_dir');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async function saveToAbyssFolder(abyssHandle, subfolderName, filename, data) {
    const opts = { mode: 'readwrite' };
    let perm = await abyssHandle.queryPermission(opts);
    if (perm !== 'granted') {
      perm = await abyssHandle.requestPermission(opts);
      if (perm !== 'granted') return false;
    }

    const subDir = await abyssHandle.getDirectoryHandle(subfolderName, { create: true });
    const fileHandle = await subDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  }

  async function checkWindowsFolderUI() {
    if (!windowsFolderSetupWrap) return;
    if (isWindows && !isLocalServerAvailable && 'showDirectoryPicker' in window) {
      windowsFolderSetupWrap.style.display = 'block';
      abyssDirHandle = await loadDirectoryHandle();
      if (abyssDirHandle) {
        try {
          const perm = await abyssDirHandle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            updateFolderUI(true);
            return;
          }
        } catch (e) {}
      }
      updateFolderUI(false);
    } else {
      windowsFolderSetupWrap.style.display = 'none';
    }
  }

  function updateFolderUI(isLinked) {
    if (!linkAbyssFolderBtn || !windowsFolderStatusText) return;
    if (isLinked) {
      linkAbyssFolderBtn.innerHTML = '<span>✔️</span> C:\\Abyss Linked (Direct Save Active)';
      linkAbyssFolderBtn.style.borderColor = 'var(--accent-emerald)';
      linkAbyssFolderBtn.style.color = 'var(--accent-emerald)';
      windowsFolderStatusText.textContent = 'Files save directly into C:\\Abyss\\PWA_Captures & PWALogs';
    } else {
      linkAbyssFolderBtn.innerHTML = '<span>📂</span> Link C:\\Abyss Folder for Direct Saving';
      linkAbyssFolderBtn.style.borderColor = 'var(--border-color)';
      linkAbyssFolderBtn.style.color = 'var(--text-main)';
      windowsFolderStatusText.textContent = 'Click to grant direct save access to C:\\Abyss without downloading';
    }
  }

  if (linkAbyssFolderBtn) {
    linkAbyssFolderBtn.addEventListener('click', async () => {
      try {
        const handle = await window.showDirectoryPicker({
          id: 'abyss_captures_folder',
          mode: 'readwrite'
        });
        abyssDirHandle = handle;
        await saveDirectoryHandle(handle);
        updateFolderUI(true);
        appendLog(`[Setup] User linked directory: ${handle.name}`);
        alert(`Successfully linked "${handle.name}"!\nCaptures will now save directly to PWA_Captures and PWALogs.`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          alert('Could not link folder: ' + err.message);
        }
      }
    });
  }

  // --- DOM Elements ---
  const platformBadge = document.getElementById('platformBadge');
  const platformText = document.getElementById('platformText');
  const systemStateBadge = document.getElementById('systemStateBadge');
  const systemStateText = document.getElementById('systemStateText');

  const cameraFrameContainer = document.getElementById('cameraFrameContainer');
  const cameraViewfinder = document.getElementById('cameraViewfinder');
  const hudStatusBanner = document.getElementById('hudStatusBanner');
  const hudStatusDot = document.getElementById('hudStatusDot');
  const hudStatusText = document.getElementById('hudStatusText');
  const hudClock = document.getElementById('hudClock');

  const motionPercentVal = document.getElementById('motionPercentVal');
  const motionThresholdVal = document.getElementById('motionThresholdVal');
  const meterFill = document.getElementById('meterFill');
  const meterThresholdLine = document.getElementById('meterThresholdLine');
  const motionDiffCanvas = document.getElementById('motionDiffCanvas');
  const diffCtx = motionDiffCanvas.getContext('2d', { willReadFrequently: true });

  const cameraSelect = document.getElementById('cameraSelect');
  const destinationSelect = document.getElementById('destinationSelect');
  const storageRouteBadge = document.getElementById('storageRouteBadge');
  const sensitivityRange = document.getElementById('sensitivityRange');
  const sensitivityLabel = document.getElementById('sensitivityLabel');
  const sensitivityNum = document.getElementById('sensitivityNum');
  const micStatusText = document.getElementById('micStatusText');

  const toggleMonitorBtn = document.getElementById('toggleMonitorBtn');
  const monitorBtnIcon = document.getElementById('monitorBtnIcon');
  const monitorBtnText = document.getElementById('monitorBtnText');
  const viewLogBtn = document.getElementById('viewLogBtn');
  const closeAppBtn = document.getElementById('closeAppBtn');

  const activeLogLabel = document.getElementById('activeLogLabel');
  const captureCountLabel = document.getElementById('captureCountLabel');
  const capturesList = document.getElementById('capturesList');

  // Modal elements
  const logModal = document.getElementById('logModal');
  const closeLogModalBtn = document.getElementById('closeLogModalBtn');
  const logContentArea = document.getElementById('logContentArea');
  const copyLogBtn = document.getElementById('copyLogBtn');
  const downloadLogFileBtn = document.getElementById('downloadLogFileBtn');

  const appClosedOverlay = document.getElementById('appClosedOverlay');
  const reopenAppBtn = document.getElementById('reopenAppBtn');

  // --- 1. Platform Detection & Init ---
  function detectPlatform() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';

    isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    isWindows = /Win/.test(platform) || /Windows/.test(ua);
    isMobileCameraDevice = isIOS || /Android/i.test(ua);

    const isStandalone = ('standalone' in window.navigator && window.navigator.standalone) ||
                         window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS) {
      if (isStandalone) {
        platformBadge.className = 'pill-badge active';
        platformText.textContent = 'iPhone (App Mode)';
        if (iosInstallStrip) iosInstallStrip.classList.add('hidden');
      } else {
        platformBadge.className = 'pill-badge';
        platformText.textContent = 'iPhone (Safari)';
        if (iosInstallStrip) iosInstallStrip.classList.remove('hidden');
      }
      destinationSelect.value = 'cameraroll';
      storageRouteBadge.textContent = 'Default: Camera Roll';
      destinationSelect.querySelector('option[value="windows"]').hidden = true;
      destinationSelect.querySelector('option[value="googledrive"]').hidden = false;
    } else if (isWindows) {
      platformBadge.className = 'pill-badge active';
      platformText.textContent = 'Windows PC';
      destinationSelect.value = 'windows';
      storageRouteBadge.textContent = 'C:\\Abyss\\PWA_Captures';
      destinationSelect.querySelector('option[value="cameraroll"]').hidden = true;
      destinationSelect.querySelector('option[value="onedrive"]').hidden = true;
      destinationSelect.querySelector('option[value="googledrive"]').hidden = true;
    } else {
      platformBadge.className = 'pill-badge';
      platformText.textContent = 'Web Browser';
      destinationSelect.querySelector('option[value="windows"]').hidden = true;
      destinationSelect.querySelector('option[value="cameraroll"]').textContent = 'Device Photos / Share Sheet';
      destinationSelect.querySelector('option[value="onedrive"]').textContent = 'OneDrive / Files';
      destinationSelect.querySelector('option[value="googledrive"]').hidden = false;
    }

    // Check if running on local server with direct Abyss API
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.isLocalServer) {
          isLocalServerAvailable = true;
          if (isWindows && destinationSelect.value === 'windows') {
            storageRouteBadge.textContent = 'Local Server (Direct Abyss Save)';
            if (windowsFolderSetupWrap) windowsFolderSetupWrap.style.display = 'none';
          }
          console.log('[System] Local Python Abyss API detected and connected.');
        }
      })
      .catch(() => {
        isLocalServerAvailable = false;
      });
  }

  detectPlatform();

  // Update clock every second
  setInterval(() => {
    const now = new Date();
    hudClock.textContent = now.toTimeString().split(' ')[0];
  }, 1000);

  // --- 2. Formatters for Filenames (Strict User Requirements) ---
  function formatTimestampParts(date = new Date()) {
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return { yyyy, MM, dd, hh, mm, ss };
  }

  function formatCaptureFilename(date = new Date(), mimeType = getSupportedMimeType()) {
    const { yyyy, MM, dd, hh, mm, ss } = formatTimestampParts(date);
    const extension = /^video\/mp4(?:;|$)/i.test(mimeType) ? 'mp4' : 'webm';
    return `Capture_${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.${extension}`;
  }

  function formatLogFilename(date = new Date()) {
    const { yyyy, MM, dd, hh, mm, ss } = formatTimestampParts(date);
    return `Log_${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.txt`;
  }

  // --- 3. Debug Logging System ---
  function appendLog(message, level = 'INFO') {
    const now = new Date();
    const timeStr = now.toISOString();
    const line = `[${timeStr}] [${level}] ${message}`;
    if (!logSessionActive) return;
    currentLogEntries.push(line);
    console.log(line);

    if (logModal.classList.contains('open')) {
      logContentArea.value = currentLogEntries.join('\n');
      logContentArea.scrollTop = logContentArea.scrollHeight;
    }
  }

  function startNewLogSession() {
    currentLogFilename = formatLogFilename(new Date());
    currentLogEntries = [];
    logSessionActive = true;
    activeLogLabel.textContent = currentLogFilename;

    appendLog(`=== PWA Security Motion Capture Debug Log Started ===`);
    appendLog(`Log File: ${currentLogFilename}`);
    appendLog(`User-Agent: ${navigator.userAgent}`);
    appendLog(`Platform: ${navigator.platform} | isIOS: ${isIOS} | isWindows: ${isWindows}`);
    appendLog(`Screen: ${window.screen.width}x${window.screen.height} | PixelRatio: ${window.devicePixelRatio}`);
    appendLog(`Selected Camera: ${selectedDeviceId || 'Default'} | Label: ${cameraSelect.options[cameraSelect.selectedIndex]?.text || 'N/A'}`);
    appendLog(`Selected Save Destination: ${destinationSelect.value}`);
    appendLog(`Motion Trigger Sensitivity: ${motionThreshold}%`);
    appendLog(`Local Server Abyss API: ${isLocalServerAvailable ? 'Active' : 'Offline / Remote'}`);
  }

  async function finalizeAndSaveLog() {
    if (!logSessionActive) return;
    appendLog(`Stopping monitoring session. Total captures recorded: ${totalCapturesCount}`);
    appendLog(`=== Debug Log Session Ended ===`);
    logSessionActive = false;

    const logText = currentLogEntries.join('\n');

    // 1. If local Python server is running on Windows, save directly to C:\Abyss\PWALogs
    if (isWindows && isLocalServerAvailable) {
      try {
        const res = await fetch('/api/save_log', {
          method: 'POST',
          headers: { 'X-Filename': currentLogFilename, 'Content-Type': 'text/plain' },
          body: logText
        });
        const data = await res.json();
        if (data.success) {
          console.log(`[Log] Saved debug log directly to: ${data.path}`);
          return;
        }
      } catch (err) {
        console.warn('[Log] Failed to auto-save log via local server API:', err);
      }
    }

    // 2. If user linked C:\Abyss folder, save directly to C:\Abyss\PWALogs
    if (abyssDirHandle) {
      try {
        const ok = await saveToAbyssFolder(abyssDirHandle, 'PWALogs', currentLogFilename, logText);
        if (ok) {
          console.log(`[Log] Saved debug log directly to C:\\Abyss\\PWALogs\\${currentLogFilename}`);
          return;
        }
      } catch (fsErr) {
        console.warn('Could not write log to Abyss directory:', fsErr);
      }
    }

    // 3. Fallback on Windows: trigger auto-download of the log file so it is never lost
    if (isWindows) {
      const logBlob = new Blob([logText], { type: 'text/plain' });
      triggerBrowserDownload(logBlob, currentLogFilename);
      console.log(`[Log] Log file downloaded: ${currentLogFilename}`);
    }
  }

  // --- 4. Camera & Audio Stream Management ---
  async function enumerateCameras() {
    if (isMobileCameraDevice) {
      cameraSelect.innerHTML = '';
      [
        { value: 'facing:environment', label: 'Rear Camera' },
        { value: 'facing:user', label: 'Front Camera' }
      ].forEach(camera => {
        const option = document.createElement('option');
        option.value = camera.value;
        option.textContent = camera.label;
        cameraSelect.appendChild(option);
      });
      cameraSelect.value = 'facing:environment';
      selectedDeviceId = cameraSelect.value;
      return;
    }

    try {
      // Trigger initial permission request to get device labels
      const devices = await navigator.mediaDevices.enumerateDevices();
      availableCameras = devices.filter(d => d.kind === 'videoinput');

      cameraSelect.innerHTML = '';

      if (availableCameras.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No camera found';
        cameraSelect.appendChild(opt);
        return;
      }

      availableCameras.forEach((cam, idx) => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        let label = cam.label || `Camera ${idx + 1}`;

        // Helpful tag for mobile
        if (/front|user|facing front/i.test(label)) {
          label = `📱 Front Camera (${label})`;
        } else if (/back|rear|environment|facing back/i.test(label)) {
          label = `📷 Rear Camera (${label})`;
        } else if (idx === 0) {
          label = `📷 Primary Camera (${label})`;
        }

        opt.textContent = label;
        cameraSelect.appendChild(opt);
      });

      // Prefer the rear camera on mobile. Device labels may stay generic until
      // the user grants permission from Start Monitoring.
      const rearCam = availableCameras.find(c => /back|rear|environment/i.test(c.label));
      if (rearCam) {
        cameraSelect.value = rearCam.deviceId;
      } else {
        cameraSelect.value = availableCameras[0].deviceId;
      }

      selectedDeviceId = cameraSelect.value;
    } catch (err) {
      console.error('Error enumerating cameras:', err);
      appendLog(`Error accessing media hardware: ${err.message}`, 'ERROR');
      cameraSelect.innerHTML = '<option value="">Camera access unavailable</option>';
    }
  }

  async function startCameraStream(deviceId) {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(t => t.stop());
      currentCameraStream = null;
    }

    const videoConstraints = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    };

    const requestedFacing = (deviceId || '').startsWith('facing:') ? deviceId.slice('facing:'.length) : '';
    if (requestedFacing) {
      videoConstraints.facingMode = { exact: requestedFacing };
    } else if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = { ideal: 'environment' };
    }

    try {
      const mediaConstraints = {
        video: videoConstraints,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      };
      try {
        currentCameraStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      } catch (firstError) {
        if (!requestedFacing) throw firstError;
        appendLog(`Exact ${requestedFacing} camera request unavailable; retrying with preferred facing mode.`, 'WARN');
        videoConstraints.facingMode = { ideal: requestedFacing };
        currentCameraStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      }

      cameraViewfinder.srcObject = currentCameraStream;

      // Check if front camera to mirror preview
      const activeTrack = currentCameraStream.getVideoTracks()[0];
      const settings = activeTrack.getSettings ? activeTrack.getSettings() : {};
      if (settings.facingMode === 'user' || /front/i.test(activeTrack.label) || requestedFacing === 'user') {
        cameraViewfinder.classList.add('mirrored');
      } else {
        cameraViewfinder.classList.remove('mirrored');
      }

      // Check audio track
      const audioTrack = currentCameraStream.getAudioTracks()[0];
      if (audioTrack && audioTrack.enabled) {
        micStatusText.textContent = `Active (${audioTrack.label || 'Mic Stream'})`;
        micStatusText.style.color = 'var(--accent-emerald)';
      }

      // Once permission is granted, browsers reveal camera names such as
      // "Front Camera" and "Back Camera". Refresh the chooser labels without
      // changing the camera the user just selected.
      if (!isMobileCameraDevice) {
        try {
          const selectedId = selectedDeviceId || settings.deviceId || '';
          availableCameras = (await navigator.mediaDevices.enumerateDevices())
            .filter(device => device.kind === 'videoinput');
          cameraSelect.innerHTML = '';
          availableCameras.forEach((cam, idx) => {
            const opt = document.createElement('option');
            opt.value = cam.deviceId;
            const label = cam.label || `Camera ${idx + 1}`;
            opt.textContent = /front|user|facing front/i.test(label)
              ? `Front Camera (${label})`
              : /back|rear|environment|facing back/i.test(label)
                ? `Rear Camera (${label})`
                : label;
            cameraSelect.appendChild(opt);
          });
          if (selectedId) selectedDeviceId = selectedId;
          cameraSelect.value = selectedId;
        } catch (enumerateError) {
          // Camera access remains usable even if the browser hides device labels.
        }
      }

      appendLog(`Stream initialized: ${activeTrack.label} (${settings.width || 1280}x${settings.height || 720})`);
    } catch (err) {
      appendLog(`Failed to start camera stream: ${err.message}`, 'ERROR');
      throw err;
    }
  }

  cameraSelect.addEventListener('change', async () => {
    selectedDeviceId = cameraSelect.value;
    appendLog(`User changed camera selection to: ${selectedDeviceId}`);
    try {
      await startCameraStream(selectedDeviceId);
    } catch (err) {
      alert(`Could not switch camera: ${err.message}`);
    }
  });

  // --- 5. Motion Detection Algorithm (Visual Frame Differencing) ---
  function getSupportedMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    if (!window.MediaRecorder) return '';
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  function startMotionAnalysis() {
    const width = motionDiffCanvas.width;
    const height = motionDiffCanvas.height;
    const totalPixels = width * height;

    motionAnalysisInterval = setInterval(() => {
      if (!isMonitoring || !currentCameraStream) return;
      if (cameraViewfinder.videoWidth === 0 || cameraViewfinder.videoHeight === 0) return;

      // Draw current video frame to offscreen canvas
      diffCtx.drawImage(cameraViewfinder, 0, 0, width, height);
      const currentFrame = diffCtx.getImageData(0, 0, width, height);
      const data = currentFrame.data;

      if (!prevFrameData) {
        prevFrameData = currentFrame;
        return;
      }

      const prevData = prevFrameData.data;
      let diffPixelCount = 0;

      // Sample every 4th pixel for speed
      for (let i = 0; i < data.length; i += 16) {
        // Luminance calculation
        const lum1 = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const lum2 = 0.299 * prevData[i] + 0.587 * prevData[i + 1] + 0.114 * prevData[i + 2];
        if (Math.abs(lum1 - lum2) > 28) {
          diffPixelCount++;
        }
      }

      const sampleCount = totalPixels / 4;
      const motionPercent = Math.min(100, Math.round((diffPixelCount / sampleCount) * 100));
      currentMotionPercent = motionPercent;

      // Update UI meter
      motionPercentVal.textContent = motionPercent + '%';
      meterFill.style.width = motionPercent + '%';

      if (motionPercent >= motionThreshold) {
        meterFill.classList.add('tripped');
        handleMotionDetected();
      } else {
        meterFill.classList.remove('tripped');
        handleMotionCleared();
      }

      prevFrameData = currentFrame;
    }, MOTION_CHECK_INTERVAL_MS);
  }

  function stopMotionAnalysis() {
    if (motionAnalysisInterval) {
      clearInterval(motionAnalysisInterval);
      motionAnalysisInterval = null;
    }
    prevFrameData = null;
    meterFill.style.width = '0%';
    meterFill.classList.remove('tripped');
    motionPercentVal.textContent = '0%';
  }

  // Sensitivity Slider
  sensitivityRange.addEventListener('input', (e) => {
    motionThreshold = parseInt(e.target.value, 10);
    motionThresholdVal.textContent = motionThreshold + '%';
    sensitivityNum.textContent = motionThreshold + '%';
    meterThresholdLine.style.left = motionThreshold + '%';

    if (motionThreshold <= 8) sensitivityLabel.textContent = 'High (Sensitive)';
    else if (motionThreshold <= 20) sensitivityLabel.textContent = 'Normal';
    else sensitivityLabel.textContent = 'Low (Heavy Motion Only)';

    appendLog(`Sensitivity threshold adjusted to: ${motionThreshold}%`);
  });

  // --- 6. The 5-Second Pre-Roll & 5-Second Post-Roll Continuous Buffering Engine ---
  /**
   * We run two overlapping MediaRecorders (A and B) offset by 5 seconds.
   * At any moment when motion is tripped:
   * One recorder has between 5 and 10 seconds of continuous pre-roll.
   * That recorder is chosen as the active event recorder and continues recording.
   * The other recorder is discarded.
   */

  function createRecorderInstance() {
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};
    try {
      const rec = new MediaRecorder(currentCameraStream, options);
      return rec;
    } catch (err) {
      appendLog(`Failed to create MediaRecorder: ${err.message}`, 'ERROR');
      return null;
    }
  }

  function startBufferCycle() {
    if (bufferRotationTimer) {
      clearInterval(bufferRotationTimer);
      bufferRotationTimer = null;
    }
    chunksA = [];
    chunksB = [];
    activeEventRecorder = null;

    // Start Recorder A
    recorderA = createRecorderInstance();
    if (!recorderA) return false;

    const bufferAChunks = chunksA;
    recorderA.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        bufferAChunks.push({ blob: e.data, receivedAt: performance.now() });
      }
    };
    try {
      recorderA.start(1000);
    } catch (err) {
      appendLog(`Failed to start pre-roll recorder: ${err.message}`, 'ERROR');
      recorderA = null;
      return false;
    }
    startTimeA = performance.now();
    appendLog(`[Buffer] Pre-roll Buffer A started at t=0`);

    // Schedule Recorder B to start 5 seconds later
    setTimeout(() => {
      if (!isMonitoring || activeEventRecorder) return;
      if (!startRecorderB()) {
        appendLog('[ERROR] Could not start the second rolling buffer. Monitoring stopped.', 'ERROR');
        stopMonitoring();
      }
    }, BUFFER_ROTATION_INTERVAL_MS);

    // Set recurring 5-second buffer rotation timer
    bufferRotationTimer = setInterval(() => {
      if (!isMonitoring || activeEventRecorder) return;
      if (!rotateIdleBuffers()) {
        appendLog('[ERROR] Could not recycle a rolling buffer. Monitoring stopped.', 'ERROR');
        stopMonitoring();
      }
    }, BUFFER_ROTATION_INTERVAL_MS);
    return true;
  }

  function startRecorderB() {
    chunksB = [];
    recorderB = createRecorderInstance();
    if (!recorderB) return false;

    const bufferBChunks = chunksB;
    recorderB.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        bufferBChunks.push({ blob: e.data, receivedAt: performance.now() });
      }
    };
    try {
      recorderB.start(1000);
    } catch (err) {
      appendLog(`Failed to start rolling buffer B: ${err.message}`, 'ERROR');
      recorderB = null;
      return false;
    }
    startTimeB = performance.now();
    appendLog(`[Buffer] Pre-roll Buffer B started at t=+5s`);
    return true;
  }

  function rotateIdleBuffers() {
    const now = performance.now();
    const ageA = (now - startTimeA) / 1000;
    const ageB = (now - startTimeB) / 1000;

    // If Recorder A is older than 10 seconds and B is ready, recycle A
    if (ageA >= 10 && recorderB && recorderB.state === 'recording') {
      appendLog(`[Buffer] Recycling Buffer A (age: ${ageA.toFixed(1)}s). Buffer B active (age: ${ageB.toFixed(1)}s).`);
      if (recorderA && recorderA.state === 'recording') {
        recorderA.stop();
      }
      chunksA = [];
      const bufferAChunks = chunksA;
      recorderA = createRecorderInstance();
      if (!recorderA) return false;
      recorderA.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) bufferAChunks.push({ blob: e.data, receivedAt: performance.now() });
      };
      try { recorderA.start(1000); } catch (err) {
        appendLog(`Failed to recycle buffer A: ${err.message}`, 'ERROR');
        recorderA = null;
        return false;
      }
      startTimeA = performance.now();
    }
    // Else if Recorder B is older than 10 seconds and A is ready, recycle B
    else if (ageB >= 10 && recorderA && recorderA.state === 'recording') {
      appendLog(`[Buffer] Recycling Buffer B (age: ${ageB.toFixed(1)}s). Buffer A active (age: ${ageA.toFixed(1)}s).`);
      if (recorderB && recorderB.state === 'recording') {
        recorderB.stop();
      }
      chunksB = [];
      const bufferBChunks = chunksB;
      recorderB = createRecorderInstance();
      if (!recorderB) return false;
      recorderB.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) bufferBChunks.push({ blob: e.data, receivedAt: performance.now() });
      };
      try { recorderB.start(1000); } catch (err) {
        appendLog(`Failed to recycle buffer B: ${err.message}`, 'ERROR');
        recorderB = null;
        return false;
      }
      startTimeB = performance.now();
    }
    return true;
  }

  function stopBufferCycle() {
    if (bufferRotationTimer) {
      clearInterval(bufferRotationTimer);
      bufferRotationTimer = null;
    }
    if (recorderA && recorderA.state === 'recording') recorderA.stop();
    if (recorderB && recorderB.state === 'recording') recorderB.stop();
    recorderA = null;
    recorderB = null;
    chunksA = [];
    chunksB = [];
    activeEventRecorder = null;
  }

  // --- 7. Event Trigger & Post-Roll Logic ---
  function handleMotionDetected() {
    if (!isMonitoring) return;

    // If post-roll countdown was ticking, motion returned! Reset post-roll.
    if (postRollCountdownTimer) {
      clearInterval(postRollCountdownTimer);
      postRollCountdownTimer = null;
      appendLog(`[Motion] Motion re-detected during post-roll. Extending active recording.`);
    }

    if (!isRecordingMotion) {
      const now = performance.now();
      const ageA = (now - startTimeA) / 1000;
      const ageB = startTimeB ? (now - startTimeB) / 1000 : 0;

      const recorderAReady = recorderA && recorderA.state === 'recording';
      const recorderBReady = recorderB && recorderB.state === 'recording';
      if (!recorderAReady && !recorderBReady) {
        appendLog('[ERROR] Motion detected but no rolling recorder is available.', 'ERROR');
        return;
      }

      // Use the older continuous buffer for the most pre-roll. During the
      // first five seconds, use whatever history is available in buffer A.
      if (recorderAReady && (!recorderBReady || ageA >= ageB)) {
        activeEventRecorder = 'A';
        trimBufferForPreRoll(chunksA, now);
        const preRollSeconds = Math.min(PRE_ROLL_SEC, ageA);
        appendLog(`[EVENT] Motion Triggered (${currentMotionPercent}%)! Selected Buffer A (Pre-roll: about ${preRollSeconds.toFixed(1)}s).`);
        if (recorderBReady) recorderB.stop();
      } else {
        activeEventRecorder = 'B';
        trimBufferForPreRoll(chunksB, now);
        const preRollSeconds = Math.min(PRE_ROLL_SEC, ageB);
        appendLog(`[EVENT] Motion Triggered (${currentMotionPercent}%)! Selected Buffer B (Pre-roll: about ${preRollSeconds.toFixed(1)}s).`);
        if (recorderAReady) recorderA.stop();
      }
      isRecordingMotion = true;
      activeEventDate = new Date();

      // Update HUD
      cameraFrameContainer.className = 'top-camera-frame motion-triggered';
      hudStatusDot.style.color = '#f43f5e';
      hudStatusText.textContent = 'MOTION DETECTED - RECORDING';
      systemStateBadge.className = 'pill-badge recording';
      systemStateText.textContent = 'RECORDING';
    }
  }

  function trimBufferForPreRoll(chunks, triggerTime) {
    const cutoff = triggerTime - PRE_ROLL_SEC * 1000;
    // Each MediaRecorder timeslice is about one second. Keep the slice that
    // overlaps the five-second boundary so the clip never starts late.
    const firstIndex = chunks.findIndex(chunk => chunk.receivedAt >= cutoff - 1000);
    if (firstIndex > 0) chunks.splice(0, firstIndex);
  }

  function handleMotionCleared() {
    if (!isMonitoring || !isRecordingMotion) return;

    // Start 5-second post-roll countdown if not already running
    if (!postRollCountdownTimer) {
      postRollRemainingSec = POST_ROLL_SEC;
      appendLog(`[Motion] Motion ceased. Starting 5.0-second post-roll cooldown.`);

      hudStatusDot.style.color = '#f59e0b';
      hudStatusText.textContent = `POST-ROLL COOLDOWN (${postRollRemainingSec}s)`;

      postRollCountdownTimer = setInterval(() => {
        postRollRemainingSec--;
        if (postRollRemainingSec > 0) {
          hudStatusText.textContent = `POST-ROLL COOLDOWN (${postRollRemainingSec}s)`;
        } else {
          // 5 seconds completed with no motion! Finalize recording!
          clearInterval(postRollCountdownTimer);
          postRollCountdownTimer = null;
          finalizeSecurityEvent();
        }
      }, 1000);
    }
  }

  async function finalizeSecurityEvent(stoppedByUser = false) {
    if (activeFinalizationPromise) return activeFinalizationPromise;
    appendLog(stoppedByUser
      ? '[EVENT] Monitoring stopped during motion. Finalizing the active capture now.'
      : '[EVENT] 5-second post-roll complete. Finalizing security capture.');
    isRecordingMotion = false;

    const chosenRecorder = activeEventRecorder === 'A' ? recorderA : recorderB;
    const chosenChunks = activeEventRecorder === 'A' ? chunksA : chunksB;

    if (!chosenRecorder || chosenRecorder.state !== 'recording') {
      appendLog(`[WARN] Active recorder not recording during finalization`, 'WARN');
      activeEventRecorder = null;
      resumeMonitoringState();
      return;
    }

    activeFinalizationPromise = new Promise((resolve) => {
      let completed = false;
      const finish = async () => {
        if (completed) return;
        completed = true;
        try {
          const mimeType = chosenRecorder.mimeType || getSupportedMimeType() || 'video/webm';
          const videoBlob = new Blob(chosenChunks.map(chunk => chunk.blob), { type: mimeType });
          if (!videoBlob.size) {
            appendLog('[ERROR] Capture was empty; no media data was produced.', 'ERROR');
            return;
          }
          const filename = formatCaptureFilename(activeEventDate || new Date(), mimeType);
          appendLog(`[Capture] Package complete: ${filename} | Type: ${mimeType} | Size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);
          await routeAndSaveCapture(videoBlob, filename);
        } catch (err) {
          appendLog(`[ERROR] Could not save capture: ${err.message}`, 'ERROR');
        } finally {
          activeEventRecorder = null;
          activeEventDate = null;
          activeFinalizationPromise = null;
          resumeMonitoringState();
          resolve();
        }
      };
      chosenRecorder.onstop = finish;
      chosenRecorder.onerror = (event) => {
        appendLog(`[ERROR] Recorder failed: ${event.error?.message || 'unknown media error'}`, 'ERROR');
      };
      try {
        chosenRecorder.stop();
      } catch (err) {
        appendLog(`[ERROR] Could not stop capture recorder: ${err.message}`, 'ERROR');
        finish();
      }
    });
    return activeFinalizationPromise;
  }

  function resumeMonitoringState() {
    if (!isMonitoring) return;

    cameraFrameContainer.className = 'top-camera-frame armed';
    hudStatusDot.style.color = '#10b981';
    hudStatusText.textContent = 'MONITORING (ARMED - 5s BUFFER)';
    systemStateBadge.className = 'pill-badge active';
    systemStateText.textContent = 'MONITORING';

    // Restart ping-pong buffer
    if (!startBufferCycle()) {
      appendLog('[ERROR] Could not start the rolling video buffer. Monitoring stopped.', 'ERROR');
      stopMonitoring();
    }
  }

  // Trigger native share on iOS from direct user interaction
  async function triggerSystemShare(blob, filename) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const shareText = destinationSelect.value === 'googledrive'
      ? 'Save security capture to Google Drive, then choose or create MyCaptures'
      : destinationSelect.value === 'onedrive'
        ? 'Save security capture to OneDrive'
        : 'Save security capture to Camera Roll';

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        appendLog(`[Share] Opening the system share sheet for: ${filename}`);
        await navigator.share({
          title: filename,
          text: shareText,
          files: [file]
        });
        appendLog(`[SUCCESS] Shared ${filename} via the system share sheet`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Share error:', err);
          appendLog(`Share sheet dismissed or error: ${err.message}`, 'WARN');
        }
      }
    } else {
      triggerBrowserDownload(blob, filename);
    }
  }

  // --- 8. File Storage Routing (Windows vs iPhone) ---
  async function routeAndSaveCapture(blob, filename) {
    const dest = destinationSelect.value;
    totalCapturesCount++;
    captureCountLabel.textContent = totalCapturesCount;

    // Always add to persistent in-app gallery & IndexedDB
    await addCaptureToGallery(blob, filename, true);

    // 1. Windows C:\Abyss\PWA_Captures (Local Server or File System Access API)
    if (dest === 'windows') {
      if (isWindows && isLocalServerAvailable) {
        try {
          const res = await fetch('/api/save_capture', {
            method: 'POST',
            headers: { 'X-Filename': filename, 'Content-Type': blob.type },
            body: blob
          });
          const result = await res.json();
          if (result.success) {
            appendLog(`[SUCCESS] Saved directly to Windows: C:\\Abyss\\PWA_Captures\\${filename}`);
            return;
          }
        } catch (err) {
          appendLog(`Local server save failed: ${err.message}. Falling back to direct folder access.`, 'WARN');
        }
      }

      // Check if user linked C:\Abyss folder via File System Access API
      if (abyssDirHandle) {
        try {
          const ok = await saveToAbyssFolder(abyssDirHandle, 'PWA_Captures', filename, blob);
          if (ok) {
            appendLog(`[SUCCESS] Saved directly to C:\\Abyss\\PWA_Captures\\${filename} via File System API!`);
            return;
          }
        } catch (fsErr) {
          appendLog(`Direct folder save error: ${fsErr.message}. Falling back to browser download.`, 'WARN');
        }
      }

      // Browser download fallback on Windows
      triggerBrowserDownload(blob, filename);
      appendLog(`[Windows] Download triggered: ${filename} (Saved to Downloads folder)`);
      return;
    }

    // 2. Mobile share targets (Photos, OneDrive, Google Drive)
    if (isIOS || dest === 'cameraroll' || dest === 'onedrive' || dest === 'googledrive') {
      appendLog(`[Capture] Stored in the app gallery: ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
      // Show floating notification toast with direct tap action (no browser download popup!)
      showCaptureToast(blob, filename);
      return;
    }
  }

  function triggerBrowserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function addCaptureToGallery(blob, filename, shouldSaveToDB = true) {
    if (shouldSaveToDB) {
      await saveCaptureToDB({
        filename,
        blob,
        size: blob.size,
        date: new Date().toISOString()
      });
    }

    // Clear placeholder message
    if (capturesList.children[0] && capturesList.children[0].textContent.includes('No security events')) {
      capturesList.innerHTML = '';
    }

    const item = document.createElement('div');
    item.className = 'capture-item';
    item.dataset.filename = filename;

    const info = document.createElement('div');
    info.className = 'capture-info';

    const name = document.createElement('div');
    name.className = 'capture-filename';
    name.textContent = filename;

    const meta = document.createElement('div');
    meta.className = 'capture-meta';
    meta.textContent = `${(blob.size / 1024 / 1024).toFixed(2)} MB • ${new Date().toLocaleTimeString()}`;

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'capture-actions';

    const saveShareBtn = document.createElement('button');
    saveShareBtn.className = 'btn-small-share';
    saveShareBtn.textContent = isWindows
      ? 'Save Video'
      : destinationSelect.value === 'onedrive' ? 'OneDrive'
        : destinationSelect.value === 'googledrive' ? 'Google Drive' : 'Camera Roll';
    saveShareBtn.onclick = () => {
      triggerSystemShare(blob, filename);
    };

    const playBtn = document.createElement('a');
    playBtn.className = 'btn-small-share';
    playBtn.style.background = 'rgba(255,255,255,0.08)';
    playBtn.style.color = '#fff';
    playBtn.textContent = '▶ View';
    playBtn.href = URL.createObjectURL(blob);
    playBtn.target = '_blank';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-small-share';
    deleteBtn.style.background = 'rgba(244,63,94,0.15)';
    deleteBtn.style.color = '#fda4af';
    deleteBtn.style.border = '1px solid rgba(244,63,94,0.3)';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete capture';
    deleteBtn.onclick = async () => {
      if (confirm(`Delete ${filename}?`)) {
        await deleteCaptureFromDB(filename);
        item.remove();
        if (capturesList.children.length === 0) {
          capturesList.innerHTML = `<div style="font-size:0.75rem; color:var(--text-dim); text-align:center; padding: 12px;">No security events captured yet.</div>`;
        }
      }
    };

    actions.appendChild(playBtn);
    actions.appendChild(saveShareBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);

    capturesList.prepend(item);
  }

  async function initSavedCaptures() {
    const saved = await loadAllCapturesFromDB();
    if (saved && saved.length > 0) {
      saved.sort((a, b) => new Date(b.date) - new Date(a.date));
      saved.forEach(item => {
        addCaptureToGallery(item.blob, item.filename, false);
      });
      totalCapturesCount = saved.length;
      captureCountLabel.textContent = totalCapturesCount;
    }
  }

  // --- 9. Start / Stop Monitoring Handler ---
  async function startMonitoring() {
    if (isMonitoring) return;
    toggleMonitorBtn.disabled = true;
    startNewLogSession();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is unavailable. Open this app over HTTPS in a supported browser.');
      }
      if (!window.MediaRecorder) {
        throw new Error('This browser does not support video recording.');
      }
      if (!currentCameraStream) await startCameraStream(selectedDeviceId);
      if (!currentCameraStream) throw new Error('The camera could not be started.');
    } catch (err) {
      appendLog(`Monitoring could not start: ${err.message}`, 'ERROR');
      await finalizeAndSaveLog();
      toggleMonitorBtn.disabled = false;
      alert(`Could not start monitoring: ${err.message}`);
      return;
    }

    isMonitoring = true;
    toggleMonitorBtn.disabled = false;
    cameraSelect.disabled = true;
    destinationSelect.disabled = true;

    // Update Button UI
    toggleMonitorBtn.classList.add('active');
    monitorBtnIcon.textContent = '⏹️';
    monitorBtnText.textContent = 'Stop Monitoring';

    cameraFrameContainer.className = 'top-camera-frame armed';
    hudStatusDot.style.color = '#10b981';
    hudStatusText.textContent = 'MONITORING (ARMED - 5s BUFFER)';
    systemStateBadge.className = 'pill-badge active';
    systemStateText.textContent = 'MONITORING';

    // Start motion detector & rolling buffers
    startMotionAnalysis();
    if (!startBufferCycle()) {
      appendLog('[ERROR] Could not start the rolling video buffer. Monitoring stopped.', 'ERROR');
      await stopMonitoring();
      return;
    }

    appendLog(`Monitoring armed. Listening for motion threshold: ${motionThreshold}%`);
  }

  async function stopMonitoring() {
    isMonitoring = false;

    if (postRollCountdownTimer) {
      clearInterval(postRollCountdownTimer);
      postRollCountdownTimer = null;
    }

    stopMotionAnalysis();
    if (isRecordingMotion || activeFinalizationPromise) {
      appendLog('[Motion] Stop requested while an event was active; the clip will be finalized now.');
    }
    // Freeze and save the session log at the Stop click. Capture finalization
    // may continue asynchronously, but it must not add more session entries.
    await finalizeAndSaveLog();

    // Keep any active event and its pre-roll, then close it cleanly when the
    // user stops monitoring instead of silently discarding the recording.
    if (activeFinalizationPromise) {
      await activeFinalizationPromise;
    } else if (isRecordingMotion && activeEventRecorder) {
      await finalizeSecurityEvent(true);
    }
    stopBufferCycle();

    // Update UI
    toggleMonitorBtn.classList.remove('active');
    cameraSelect.disabled = false;
    destinationSelect.disabled = false;
    monitorBtnIcon.textContent = '▶️';
    monitorBtnText.textContent = 'Start Monitoring';

    cameraFrameContainer.className = 'top-camera-frame';
    hudStatusDot.style.color = '#9ca3af';
    hudStatusText.textContent = 'STANDBY';
    systemStateBadge.className = 'pill-badge';
    systemStateText.textContent = 'Standby';

  }

  toggleMonitorBtn.addEventListener('click', () => {
    if (!isMonitoring) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
  });

  // --- 10. Debug Log Modal & One-Click Copy ---
  viewLogBtn.addEventListener('click', () => {
    logContentArea.value = currentLogEntries.length > 0
      ? currentLogEntries.join('\n')
      : `[No active log session]\nClick "Start Monitoring" to generate a debug log.`;
    logModal.classList.add('open');
  });

  closeLogModalBtn.addEventListener('click', () => {
    logModal.classList.remove('open');
  });

  copyLogBtn.addEventListener('click', async () => {
    const text = logContentArea.value;
    try {
      await navigator.clipboard.writeText(text);
      copyLogBtn.innerHTML = '<span>✔️</span> Copied to Clipboard!';
      setTimeout(() => {
        copyLogBtn.innerHTML = '<span>📄</span> Copy Log to Clipboard';
      }, 2000);
    } catch (err) {
      // Fallback
      logContentArea.select();
      document.execCommand('copy');
      copyLogBtn.innerHTML = '<span>✔️</span> Copied!';
      setTimeout(() => {
        copyLogBtn.innerHTML = '<span>📄</span> Copy Log to Clipboard';
      }, 2000);
    }
  });

  downloadLogFileBtn.addEventListener('click', () => {
    const text = logContentArea.value;
    const filename = currentLogFilename || formatLogFilename(new Date());
    const blob = new Blob([text], { type: 'text/plain' });
    triggerBrowserDownload(blob, filename);
  });

  // --- 11. Close App Button (Requirement 5) ---
  closeAppBtn.addEventListener('click', async () => {
    if (isMonitoring) {
      await stopMonitoring();
    }

    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach(t => t.stop());
      currentCameraStream = null;
    }

    appendLog(`User tapped Close App. Media tracks terminated.`);

    // Try closing window
    window.close();

    // Show fallback overlay
    appClosedOverlay.classList.remove('hidden');
  });

  reopenAppBtn.addEventListener('click', async () => {
    appClosedOverlay.classList.add('hidden');
    try {
      await startCameraStream(selectedDeviceId);
    } catch (err) {
      alert(`Could not reopen the camera: ${err.message}`);
      appClosedOverlay.classList.remove('hidden');
    }
  });

  // --- 12. Service Worker Registration ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
        .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
    });
  }

  // Initial load
  enumerateCameras();
  checkWindowsFolderUI();
  initSavedCaptures();

  // Also listen for destination select change
  if (destinationSelect) {
    destinationSelect.addEventListener('change', () => {
      if (destinationSelect.value === 'windows' && isWindows) {
        checkWindowsFolderUI();
      } else if (windowsFolderSetupWrap) {
        windowsFolderSetupWrap.style.display = 'none';
      }
      if (destinationSelect.value === 'onedrive') {
        storageRouteBadge.textContent = 'Share Sheet: OneDrive';
      } else if (destinationSelect.value === 'googledrive') {
        storageRouteBadge.textContent = 'Share Sheet: Google Drive';
      } else if (destinationSelect.value === 'cameraroll') {
        storageRouteBadge.textContent = 'Share Sheet: Camera Roll';
      } else {
        storageRouteBadge.textContent = isLocalServerAvailable
          ? 'Local Server (Direct Abyss Save)'
          : 'C:\\Abyss\\PWA_Captures';
      }
    });
  }

})();
