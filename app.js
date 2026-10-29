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
  let isLocalServerAvailable = false;
  let totalCapturesCount = 0;

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

    if (isIOS) {
      platformBadge.className = 'pill-badge active';
      platformText.textContent = 'Apple iOS (iPhone)';
      destinationSelect.value = 'cameraroll';
      storageRouteBadge.textContent = 'Default: Camera Roll';
    } else if (isWindows) {
      platformBadge.className = 'pill-badge active';
      platformText.textContent = 'Windows PC';
      destinationSelect.value = 'windows';
      storageRouteBadge.textContent = 'C:\\Abyss\\PWA_Captures';
    } else {
      platformBadge.className = 'pill-badge';
      platformText.textContent = 'Web Browser';
    }

    // Check if running on local server with direct Abyss API
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.isLocalServer) {
          isLocalServerAvailable = true;
          storageRouteBadge.textContent = 'Local Server (Direct Abyss Save)';
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

  function formatCaptureFilename(date = new Date()) {
    const { yyyy, MM, dd, hh, mm, ss } = formatTimestampParts(date);
    return `Capture_${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}.mp4`;
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

    // If local Python server is running on Windows, save directly to C:\Abyss\PWALogs
    if (isLocalServerAvailable) {
      try {
        const res = await fetch('/api/save_log', {
          method: 'POST',
          headers: { 'X-Filename': currentLogFilename, 'Content-Type': 'text/plain' },
          body: logText
        });
        const data = await res.json();
        if (data.success) {
          console.log(`[Log] Saved debug log directly to: ${data.path}`);
        }
      } catch (err) {
        console.warn('[Log] Failed to auto-save log via local server API:', err);
      }
    }
  }

  // --- 4. Camera & Audio Stream Management ---
  async function enumerateCameras() {
    try {
      // Trigger initial permission request to get device labels
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      tempStream.getTracks().forEach(t => t.stop());

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

      // Default to rear camera on mobile if available
      const rearCam = availableCameras.find(c => /back|rear|environment/i.test(c.label));
      if (rearCam) {
        cameraSelect.value = rearCam.deviceId;
      } else {
        cameraSelect.value = availableCameras[0].deviceId;
      }

      selectedDeviceId = cameraSelect.value;
      await startCameraStream(selectedDeviceId);
    } catch (err) {
      console.error('Error enumerating cameras:', err);
      appendLog(`Error accessing media hardware: ${err.message}`, 'ERROR');
      alert('Camera / Microphone permission required: ' + err.message);
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

    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    } else {
      videoConstraints.facingMode = { ideal: 'environment' };
    }

    try {
      currentCameraStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      });

      cameraViewfinder.srcObject = currentCameraStream;

      // Check if front camera to mirror preview
      const activeTrack = currentCameraStream.getVideoTracks()[0];
      const settings = activeTrack.getSettings ? activeTrack.getSettings() : {};
      if (settings.facingMode === 'user' || /front/i.test(activeTrack.label)) {
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

      appendLog(`Stream initialized: ${activeTrack.label} (${settings.width || 1280}x${settings.height || 720})`);
    } catch (err) {
      appendLog(`Failed to start camera stream: ${err.message}`, 'ERROR');
      alert(`Could not start camera: ${err.message}`);
    }
  }

  cameraSelect.addEventListener('change', async () => {
    selectedDeviceId = cameraSelect.value;
    appendLog(`User changed camera selection to: ${selectedDeviceId}`);
    await startCameraStream(selectedDeviceId);
  });

  // --- 5. Motion Detection Algorithm (Visual Frame Differencing) ---
  function getSupportedMimeType() {
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
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
    chunksA = [];
    chunksB = [];
    activeEventRecorder = null;

    // Start Recorder A
    recorderA = createRecorderInstance();
    if (!recorderA) return;

    recorderA.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksA.push(e.data);
      }
    };
    recorderA.start(1000);
    startTimeA = performance.now();
    appendLog(`[Buffer] Pre-roll Buffer A started at t=0`);

    // Schedule Recorder B to start 5 seconds later
    setTimeout(() => {
      if (!isMonitoring || activeEventRecorder) return;
      startRecorderB();
    }, BUFFER_ROTATION_INTERVAL_MS);

    // Set recurring 5-second buffer rotation timer
    bufferRotationTimer = setInterval(() => {
      if (!isMonitoring || activeEventRecorder) return;
      rotateIdleBuffers();
    }, BUFFER_ROTATION_INTERVAL_MS);
  }

  function startRecorderB() {
    chunksB = [];
    recorderB = createRecorderInstance();
    if (!recorderB) return;

    recorderB.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksB.push(e.data);
      }
    };
    recorderB.start(1000);
    startTimeB = performance.now();
    appendLog(`[Buffer] Pre-roll Buffer B started at t=+5s`);
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
      recorderA = createRecorderInstance();
      recorderA.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksA.push(e.data);
      };
      recorderA.start(1000);
      startTimeA = performance.now();
    }
    // Else if Recorder B is older than 10 seconds and A is ready, recycle B
    else if (ageB >= 10 && recorderA && recorderA.state === 'recording') {
      appendLog(`[Buffer] Recycling Buffer B (age: ${ageB.toFixed(1)}s). Buffer A active (age: ${ageA.toFixed(1)}s).`);
      if (recorderB && recorderB.state === 'recording') {
        recorderB.stop();
      }
      chunksB = [];
      recorderB = createRecorderInstance();
      recorderB.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksB.push(e.data);
      };
      recorderB.start(1000);
      startTimeB = performance.now();
    }
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
      isRecordingMotion = true;
      const now = performance.now();
      const ageA = (now - startTimeA) / 1000;
      const ageB = startTimeB ? (now - startTimeB) / 1000 : 0;

      // Select whichever buffer has at least ~5 seconds of pre-roll
      if (ageA >= 4.5 && (ageA <= 10.5 || ageB < 4.5)) {
        activeEventRecorder = 'A';
        appendLog(`[EVENT] Motion Triggered (${currentMotionPercent}%)! Selected Buffer A (Pre-roll: ${ageA.toFixed(1)}s).`);
        if (recorderB && recorderB.state === 'recording') recorderB.stop();
      } else {
        activeEventRecorder = 'B';
        appendLog(`[EVENT] Motion Triggered (${currentMotionPercent}%)! Selected Buffer B (Pre-roll: ${ageB.toFixed(1)}s).`);
        if (recorderA && recorderA.state === 'recording') recorderA.stop();
      }

      // Update HUD
      cameraFrameContainer.className = 'top-camera-frame motion-triggered';
      hudStatusDot.style.color = '#f43f5e';
      hudStatusText.textContent = 'MOTION DETECTED - RECORDING';
      systemStateBadge.className = 'pill-badge recording';
      systemStateText.textContent = 'RECORDING';
    }
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

  async function finalizeSecurityEvent() {
    appendLog(`[EVENT] 5-second post-roll complete. Finalizing security capture.`);
    isRecordingMotion = false;

    const chosenRecorder = activeEventRecorder === 'A' ? recorderA : recorderB;
    const chosenChunks = activeEventRecorder === 'A' ? chunksA : chunksB;

    if (!chosenRecorder || chosenRecorder.state !== 'recording') {
      appendLog(`[WARN] Active recorder not recording during finalization`, 'WARN');
      resumeMonitoringState();
      return;
    }

    // Set onstop handler to package and export the file
    chosenRecorder.onstop = async () => {
      const mimeType = getSupportedMimeType() || 'video/mp4';
      const videoBlob = new Blob(chosenChunks, { type: mimeType });
      const filename = formatCaptureFilename(new Date());

      appendLog(`[Capture] Package complete: ${filename} | Size: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB`);

      await routeAndSaveCapture(videoBlob, filename);

      // Add to on-screen gallery
      addCaptureToGallery(videoBlob, filename);

      // Reset and resume pre-roll buffer cycle for next event
      resumeMonitoringState();
    };

    chosenRecorder.stop();
  }

  function resumeMonitoringState() {
    if (!isMonitoring) return;

    cameraFrameContainer.className = 'top-camera-frame armed';
    hudStatusDot.style.color = '#10b981';
    hudStatusText.textContent = 'MONITORING (ARMED - 5s BUFFER)';
    systemStateBadge.className = 'pill-badge active';
    systemStateText.textContent = 'MONITORING';

    // Restart ping-pong buffer
    startBufferCycle();
  }

  // --- 8. File Storage Routing (Windows vs iPhone) ---
  async function routeAndSaveCapture(blob, filename) {
    const dest = destinationSelect.value;
    totalCapturesCount++;
    captureCountLabel.textContent = totalCapturesCount;

    // 1. Windows C:\Abyss\PWA_Captures (Local Server)
    if (dest === 'windows' || isLocalServerAvailable) {
      if (isLocalServerAvailable) {
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
          appendLog(`Local server save failed: ${err.message}. Falling back to browser save.`, 'WARN');
        }
      }

      // Browser download fallback on Windows
      triggerBrowserDownload(blob, filename);
      appendLog(`[Windows] Download triggered: ${filename}`);
      return;
    }

    // 2. iPhone Camera Roll (Default on iOS)
    if (dest === 'cameraroll') {
      const file = new File([blob], filename, { type: 'video/mp4' });

      // iOS Web Share API allows saving directly to Camera Roll
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          appendLog(`[iOS] Opening iOS Share Sheet for Camera Roll save...`);
          await navigator.share({
            title: filename,
            text: 'Save Security Capture to Camera Roll',
            files: [file]
          });
          appendLog(`[SUCCESS] User shared/saved ${filename} to Camera Roll`);
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            appendLog(`Share error: ${err.message}`, 'WARN');
          }
        }
      }

      // Fallback
      triggerBrowserDownload(blob, filename);
      return;
    }

    // 3. iPhone OneDrive / Files App
    if (dest === 'onedrive') {
      const file = new File([blob], filename, { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          appendLog(`[OneDrive] Opening iOS Share Sheet to save to OneDrive / Files...`);
          await navigator.share({
            title: filename,
            text: 'Select OneDrive folder to save capture',
            files: [file]
          });
          appendLog(`[SUCCESS] Exported ${filename} to OneDrive/Files destination`);
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            appendLog(`OneDrive share error: ${err.message}`, 'WARN');
          }
        }
      }
      triggerBrowserDownload(blob, filename);
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

  function addCaptureToGallery(blob, filename) {
    // Clear placeholder message
    if (capturesList.children[0] && capturesList.children[0].textContent.includes('No security events')) {
      capturesList.innerHTML = '';
    }

    const item = document.createElement('div');
    item.className = 'capture-item';

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

    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-small-share';
    shareBtn.innerHTML = isIOS ? '📲 Camera Roll' : '💾 Save';
    shareBtn.onclick = () => {
      routeAndSaveCapture(blob, filename);
    };

    const playBtn = document.createElement('a');
    playBtn.className = 'btn-small-share';
    playBtn.style.background = 'rgba(255,255,255,0.08)';
    playBtn.style.color = '#fff';
    playBtn.textContent = '▶ View';
    playBtn.href = URL.createObjectURL(blob);
    playBtn.target = '_blank';

    actions.appendChild(playBtn);
    actions.appendChild(shareBtn);

    item.appendChild(info);
    item.appendChild(actions);

    capturesList.prepend(item);
  }

  // --- 9. Start / Stop Monitoring Handler ---
  async function startMonitoring() {
    if (!currentCameraStream) {
      await startCameraStream(selectedDeviceId);
    }

    isMonitoring = true;
    startNewLogSession();

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
    startBufferCycle();

    appendLog(`Monitoring armed. Listening for motion threshold: ${motionThreshold}%`);
  }

  async function stopMonitoring() {
    isMonitoring = false;
    isRecordingMotion = false;

    if (postRollCountdownTimer) {
      clearInterval(postRollCountdownTimer);
      postRollCountdownTimer = null;
    }

    stopMotionAnalysis();
    stopBufferCycle();

    // Update UI
    toggleMonitorBtn.classList.remove('active');
    monitorBtnIcon.textContent = '▶️';
    monitorBtnText.textContent = 'Start Monitoring';

    cameraFrameContainer.className = 'top-camera-frame';
    hudStatusDot.style.color = '#9ca3af';
    hudStatusText.textContent = 'STANDBY';
    systemStateBadge.className = 'pill-badge';
    systemStateText.textContent = 'Standby';

    await finalizeAndSaveLog();
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
    await startCameraStream(selectedDeviceId);
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

})();
