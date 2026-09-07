const elements = {
  video: document.getElementById("camera"),
  canvas: document.getElementById("overlay"),
  emptyState: document.getElementById("emptyState"),
  emptyStateCopy: document.getElementById("emptyStateCopy"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  phoneCount: document.getElementById("phoneCount"),
  alarmState: document.getElementById("alarmState"),
  viewerLabel: document.getElementById("viewerLabel"),
  alertBanner: document.getElementById("alertBanner"),
  alarmAudio: document.getElementById("alarmAudio"),
  safetyBadge: document.getElementById("safetyBadge"),
  confidenceValue: document.getElementById("confidenceValue"),
  statusMeta: document.getElementById("statusMeta"),
  feedStateValue: document.getElementById("feedStateValue"),
  panelTitle: document.getElementById("panelTitle"),
  profileValue: document.getElementById("profileValue"),
  soundModeValue: document.getElementById("soundModeValue"),
  sessionTimeValue: document.getElementById("sessionTimeValue"),
  alertCountValue: document.getElementById("alertCountValue"),
  longestStreakValue: document.getElementById("longestStreakValue"),
  settingsButton: document.getElementById("settingsButton"),
  closeSettingsButton: document.getElementById("closeSettingsButton"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  settingsDrawer: document.getElementById("settingsDrawer"),
  profileGrid: document.getElementById("profileGrid"),
  customObjectRow: document.getElementById("customObjectRow"),
  customObjectInput: document.getElementById("customObjectInput"),
  sensitivitySlider: document.getElementById("sensitivitySlider"),
  sensitivityValue: document.getElementById("sensitivityValue"),
  cooldownSlider: document.getElementById("cooldownSlider"),
  cooldownLabelValue: document.getElementById("cooldownLabelValue"),
  soundModeGroup: document.getElementById("soundModeGroup"),
  cameraFacingGroup: document.getElementById("cameraFacingGroup"),
  resetSettingsButton: document.getElementById("resetSettingsButton"),
  showBoxesToggle: document.getElementById("showBoxesToggle"),
  testAlertButton: document.getElementById("testAlertButton"),
};

const SETTINGS_STORAGE_KEY = "focusguard.settings";

const DEFAULT_SETTINGS = {
  profile: "phone",
  customObject: "",
  minScore: 0.22,
  cooldownMs: 3000,
  soundMode: "full",
  facingMode: "environment",
  showBoxes: true,
};

const PROFILES = {
  phone: {
    label: "Phone-Free Zone",
    panelTitle: "Camera feed",
    emptyCopy: "Start the camera to arm the AI detector and switch this dashboard into live monitoring mode.",
    classes: () => ["cell phone", "remote"],
    mode: "presence",
    badgeText: "Phone detected",
    bannerText: "Phone detected — alert system active.",
    trackedLabel: (count) => (count === 1 ? "Phone-like device in frame" : `${count} phone-like devices in frame`),
    boxLabel: (item) => `${item.class === "remote" ? "Possible phone" : "Phone"} ${Math.round(item.score * 100)}%`,
  },
  presence: {
    label: "Presence Guard",
    panelTitle: "Presence monitor",
    emptyCopy: "Start the camera to make sure you stay in frame. Front camera is recommended for this mode.",
    classes: () => ["person"],
    mode: "absence",
    badgeText: "Away from desk",
    bannerText: "You left the frame — alert system active.",
    trackedLabel: () => "No one detected in frame",
    boxLabel: (item) => `Person ${Math.round(item.score * 100)}%`,
  },
  intruder: {
    label: "Intruder Alert",
    panelTitle: "Intruder watch",
    emptyCopy: "Start the camera to get alerted the moment a second person enters the frame.",
    classes: () => ["person"],
    mode: "count-above",
    threshold: 1,
    badgeText: "Extra person",
    bannerText: "Extra person detected — alert system active.",
    trackedLabel: (count) => `${count} people detected in frame`,
    boxLabel: (item) => `Person ${Math.round(item.score * 100)}%`,
  },
  custom: {
    label: "Custom Object",
    panelTitle: "Custom object watch",
    emptyCopy: "Choose an object in Settings, then start the camera to watch for it.",
    classes: () => (state.settings.customObject ? [state.settings.customObject.trim().toLowerCase()] : []),
    mode: "presence",
    badgeText: "Target detected",
    bannerText: "Target object detected — alert system active.",
    trackedLabel: (count) => `${count} target object${count === 1 ? "" : "s"} detected`,
    boxLabel: (item) => `${item.class} ${Math.round(item.score * 100)}%`,
  },
};

const state = {
  model: null,
  stream: null,
  isRunning: false,
  isDetecting: false,
  animationFrameId: null,
  lastAlertAt: 0,
  alarmReady: false,
  sirenContext: null,
  sirenTimeoutId: null,
  threatActive: false,
  threatStreak: 0,
  clearStreak: 0,
  lastMatches: [],
  settings: loadSettings(),
  session: {
    startedAt: null,
    alertCount: 0,
    longestCleanMs: 0,
    cleanSinceMs: null,
    timerId: null,
  },
};

const DETECTION_INTERVAL_MS = 180;
const SIREN_DURATION_MS = 180;
const DETECTION_CONFIRM_FRAMES = 2;
const DETECTION_GRACE_FRAMES = 4;
let lastDetectionTime = 0;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
  } catch (error) {
    console.warn("Could not persist settings:", error);
  }
}

function getActiveProfile() {
  return PROFILES[state.settings.profile] || PROFILES.phone;
}

elements.startButton.addEventListener("click", startDetection);
elements.stopButton.addEventListener("click", stopDetection);
window.addEventListener("beforeunload", stopDetection);

initSettingsUi();
applyProfileToDashboard();
applyDayTheme();

function initSettingsUi() {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.settingsOverlay.addEventListener("click", closeSettings);

  elements.profileGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".profile-option");
    if (!button) return;
    setProfile(button.dataset.profile);
  });

  elements.customObjectInput.value = state.settings.customObject;
  elements.customObjectInput.addEventListener("input", (event) => {
    state.settings.customObject = event.target.value;
    saveSettings();
    applyProfileToDashboard();
  });

  elements.sensitivitySlider.value = String(state.settings.minScore);
  updateSensitivityLabel();
  elements.sensitivitySlider.addEventListener("input", (event) => {
    state.settings.minScore = Number(event.target.value);
    updateSensitivityLabel();
    saveSettings();
  });

  elements.cooldownSlider.value = String(state.settings.cooldownMs / 1000);
  elements.cooldownLabelValue.textContent = `${state.settings.cooldownMs / 1000}s`;
  elements.cooldownSlider.addEventListener("input", (event) => {
    state.settings.cooldownMs = Number(event.target.value) * 1000;
    elements.cooldownLabelValue.textContent = `${event.target.value}s`;
    saveSettings();
  });

  elements.soundModeGroup.addEventListener("click", (event) => {
    const button = event.target.closest(".segmented-option");
    if (!button) return;
    setSoundMode(button.dataset.sound);
  });

  elements.cameraFacingGroup.addEventListener("click", (event) => {
    const button = event.target.closest(".segmented-option");
    if (!button) return;
    setCameraFacing(button.dataset.facing);
  });

  elements.resetSettingsButton.addEventListener("click", resetSettings);

  if (elements.showBoxesToggle) {
    syncToggle(elements.showBoxesToggle, state.settings.showBoxes);
    elements.showBoxesToggle.addEventListener("click", () => {
      state.settings.showBoxes = !state.settings.showBoxes;
      syncToggle(elements.showBoxesToggle, state.settings.showBoxes);
      saveSettings();
    });
  }

  if (elements.testAlertButton) {
    elements.testAlertButton.addEventListener("click", async () => {
      if (!state.alarmReady) {
        await prepareAlarm();
      }
      restartAlarmSequence();
    });
  }

  syncSettingsUiFromState();
}

function syncSettingsUiFromState() {
  setActiveButton(elements.profileGrid, ".profile-option", "profile", state.settings.profile);
  setActiveButton(elements.soundModeGroup, ".segmented-option", "sound", state.settings.soundMode);
  setActiveButton(elements.cameraFacingGroup, ".segmented-option", "facing", state.settings.facingMode);
  elements.customObjectRow.hidden = state.settings.profile !== "custom";
  if (elements.showBoxesToggle) {
    syncToggle(elements.showBoxesToggle, state.settings.showBoxes);
  }
}

function setActiveButton(container, selector, dataKey, value) {
  container.querySelectorAll(selector).forEach((button) => {
    button.classList.toggle("active", button.dataset[dataKey] === value);
  });
}

function syncToggle(button, isActive) {
  button.classList.toggle("active", isActive);
  button.setAttribute("aria-checked", String(isActive));
}

function openSettings() {
  elements.settingsDrawer.classList.add("open");
  elements.settingsDrawer.setAttribute("aria-hidden", "false");
  elements.settingsOverlay.classList.add("visible");
  elements.settingsButton.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  elements.settingsDrawer.classList.remove("open");
  elements.settingsDrawer.setAttribute("aria-hidden", "true");
  elements.settingsOverlay.classList.remove("visible");
  elements.settingsButton.setAttribute("aria-expanded", "false");
}

function setProfile(profileKey) {
  if (!PROFILES[profileKey] || state.settings.profile === profileKey) {
    return;
  }
  state.settings.profile = profileKey;
  saveSettings();
  syncSettingsUiFromState();
  applyProfileToDashboard();
  resetThreatTracking();
}

function setSoundMode(mode) {
  state.settings.soundMode = mode;
  saveSettings();
  syncSettingsUiFromState();
  applyProfileToDashboard();
}

function setCameraFacing(facing) {
  if (state.settings.facingMode === facing) {
    return;
  }
  state.settings.facingMode = facing;
  saveSettings();
  syncSettingsUiFromState();
  if (state.isRunning) {
    restartCameraStream();
  }
}

function resetSettings() {
  state.settings = { ...DEFAULT_SETTINGS };
  elements.customObjectInput.value = "";
  elements.sensitivitySlider.value = String(DEFAULT_SETTINGS.minScore);
  elements.cooldownSlider.value = String(DEFAULT_SETTINGS.cooldownMs / 1000);
  updateSensitivityLabel();
  elements.cooldownLabelValue.textContent = `${DEFAULT_SETTINGS.cooldownMs / 1000}s`;
  saveSettings();
  syncSettingsUiFromState();
  applyProfileToDashboard();
  resetThreatTracking();
  if (state.isRunning) {
    restartCameraStream();
  }
}

function updateSensitivityLabel() {
  const value = state.settings.minScore;
  elements.sensitivityValue.textContent = value <= 0.22 ? "Loose" : value >= 0.4 ? "Strict" : "Balanced";
}

function applyProfileToDashboard() {
  const profile = getActiveProfile();
  elements.profileValue.textContent = profile.label;
  elements.panelTitle.textContent = profile.panelTitle;
  elements.emptyStateCopy.textContent = profile.emptyCopy;
  const soundLabels = { full: "Siren + Audio", siren: "Siren Only", silent: "Silent" };
  elements.soundModeValue.textContent = soundLabels[state.settings.soundMode] || "Siren + Audio";
}

function resetThreatTracking() {
  state.threatActive = false;
  state.threatStreak = 0;
  state.clearStreak = 0;
  state.lastMatches = [];
  clearOverlay();
  setIdleAlertUi();
  if (state.isRunning) {
    setStatus("Safe", false);
  }
}

async function restartCameraStream() {
  const wasRunning = state.isRunning;
  if (!wasRunning) {
    return;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: buildVideoConstraints(),
    });
    elements.video.srcObject = state.stream;
    await elements.video.play();
    syncCanvasSize();
  } catch (error) {
    console.error("Could not switch camera:", error);
    setStatus("Camera switch failed");
  }
}

function buildVideoConstraints() {
  return {
    facingMode: { ideal: state.settings.facingMode },
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 24, max: 30 },
  };
}

async function startDetection() {
  if (state.isRunning) {
    return;
  }

  elements.startButton.disabled = true;
  setIdleAlertUi();
  setStatus("Loading model");
  elements.viewerLabel.textContent = "Preparing camera";

  try {
    await prepareAlarm();

    if (!state.model) {
      state.model = await cocoSsd.load({ base: "mobilenet_v2" });
    }

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: buildVideoConstraints(),
    });

    elements.video.srcObject = state.stream;
    await elements.video.play();
    syncCanvasSize();

    state.isRunning = true;
    elements.stopButton.disabled = false;
    elements.video.style.display = "block";
    elements.canvas.style.display = "block";
    elements.emptyState.style.display = "none";
    elements.viewerLabel.textContent = "Live detection running";
    elements.feedStateValue.textContent = "Online";
    setStatus("Scanning");
    startSessionStats();
    resetThreatTracking();
    tick();
  } catch (error) {
    console.error(error);
    elements.startButton.disabled = false;
    elements.stopButton.disabled = true;
    setStatus("Failed to start");
    elements.viewerLabel.textContent = "Allow camera permission and try again";
    elements.alarmState.textContent = "Blocked";
  }
}

function stopDetection() {
  state.isRunning = false;
  state.isDetecting = false;

  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  elements.alarmAudio.pause();
  elements.alarmAudio.currentTime = 0;
  stopSiren();
  clearOverlay();
  setIdleAlertUi();
  elements.video.style.display = "none";
  elements.canvas.style.display = "none";
  elements.emptyState.style.display = "grid";
  elements.viewerLabel.textContent = "Camera offline";
  elements.feedStateValue.textContent = "Offline";
  elements.phoneCount.textContent = "0";
  if (elements.confidenceValue) {
    elements.confidenceValue.textContent = "0%";
  }
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  resetThreatTracking();
  stopSessionStats();
  setStatus("Safe", false);
}

async function tick(now = 0) {
  if (!state.isRunning) {
    return;
  }

  state.animationFrameId = requestAnimationFrame(tick);

  if (state.isDetecting || now - lastDetectionTime < DETECTION_INTERVAL_MS) {
    return;
  }

  if (elements.video.readyState < 2 || !state.model) {
    return;
  }

  lastDetectionTime = now;
  state.isDetecting = true;

  try {
    syncCanvasSize();
    const predictions = await state.model.detect(elements.video, 20, state.settings.minScore);
    evaluateAndRender(predictions);
  } catch (error) {
    console.error("Detection error:", error);
    setStatus("Detection paused");
  } finally {
    state.isDetecting = false;
  }
}

function evaluateAndRender(predictions) {
  const profile = getActiveProfile();
  const targetClasses = profile.classes();

  const matches = targetClasses.length
    ? predictions
        .filter((prediction) => targetClasses.includes(prediction.class) && prediction.score >= state.settings.minScore)
        .sort((first, second) => second.score - first.score)
        .slice(0, 5)
    : [];

  let rawThreat;
  if (profile.mode === "absence") {
    rawThreat = matches.length === 0;
  } else if (profile.mode === "count-above") {
    rawThreat = matches.length > profile.threshold;
  } else {
    rawThreat = matches.length > 0;
  }

  if (matches.length > 0) {
    state.lastMatches = matches;
  }

  const wasThreatActive = state.threatActive;
  const isThreatActive = updateThreatState(rawThreat);

  const justTriggered = !wasThreatActive && isThreatActive;
  const justCleared = wasThreatActive && !isThreatActive;

  if (justCleared) {
    markCleanStreakStart();
    resetAlertPlayback();
  }

  const boxesToDraw = profile.mode !== "absence" && isThreatActive ? (matches.length ? matches : state.lastMatches) : [];

  renderDetections({ boxes: boxesToDraw, isThreatActive, profile, rawMatchCount: matches.length, justTriggered });
}

function updateThreatState(rawThreat) {
  if (rawThreat) {
    state.threatStreak += 1;
    state.clearStreak = 0;
  } else {
    state.clearStreak += 1;
    state.threatStreak = 0;
  }

  if (!state.threatActive && state.threatStreak >= DETECTION_CONFIRM_FRAMES) {
    state.threatActive = true;
  } else if (state.threatActive && state.clearStreak >= DETECTION_GRACE_FRAMES) {
    state.threatActive = false;
  }

  return state.threatActive;
}

function renderDetections({ boxes, isThreatActive, profile, rawMatchCount, justTriggered }) {
  const context = elements.canvas.getContext("2d");
  clearOverlay();
  elements.phoneCount.textContent = String(profile.mode === "absence" ? (isThreatActive ? 0 : 1) : rawMatchCount);

  if (!isThreatActive) {
    if (elements.confidenceValue) {
      elements.confidenceValue.textContent = "0%";
    }
    setIdleAlertUi();
    if (state.isRunning) {
      setStatus("Safe", false);
      elements.viewerLabel.textContent = "Live detection running";
    }
    return;
  }

  if (elements.confidenceValue) {
    const topScore = boxes.length ? Math.max(...boxes.map((item) => item.score)) : 1;
    elements.confidenceValue.textContent = `${Math.round(topScore * 100)}%`;
  }

  document.body.classList.add("alert-mode");
  elements.alertBanner.classList.add("visible");
  elements.alertBanner.textContent = profile.bannerText;
  setStatus(profile.badgeText, true);
  elements.viewerLabel.textContent = profile.trackedLabel(profile.mode === "absence" ? 0 : boxes.length || rawMatchCount);

  if (justTriggered) {
    maybePlayAlarm();
    registerAlertTriggered();
  }

  if (state.settings.showBoxes) {
    context.lineWidth = 2.5;
    context.font = '600 15px "JetBrains Mono", monospace';

    boxes.forEach((item) => {
      const [x, y, width, height] = item.bbox;
      const label = profile.boxLabel(item);

      context.strokeStyle = "#f87171";
      context.fillStyle = "rgba(248, 113, 113, 0.12)";
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);

      const labelWidth = context.measureText(label).width + 18;
      context.fillStyle = "#f87171";
      context.fillRect(x, Math.max(0, y - 28), labelWidth, 28);
      context.fillStyle = "#ffffff";
      context.fillText(label, x + 9, Math.max(19, y - 9));
    });
  }
}

function maybePlayAlarm() {
  if (!state.alarmReady) {
    return;
  }

  const now = Date.now();
  if (now - state.lastAlertAt < state.settings.cooldownMs) {
    return;
  }

  state.lastAlertAt = now;
  restartAlarmSequence();

  if (navigator.vibrate) {
    navigator.vibrate([220, 90, 220]);
  }
}

async function prepareAlarm() {
  elements.alarmAudio.volume = 1;

  try {
    await primeSiren();
    elements.alarmAudio.currentTime = 0;
    const playPromise = elements.alarmAudio.play();
    if (playPromise) {
      await playPromise;
    }
    elements.alarmAudio.pause();
    elements.alarmAudio.currentTime = 0;
    state.alarmReady = true;
    elements.alarmState.textContent = "Armed";
  } catch (error) {
    console.error("Audio setup failed:", error);
    state.alarmReady = false;
    elements.alarmState.textContent = "Blocked";
  }
}

async function primeSiren() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (!state.sirenContext || state.sirenContext.state === "closed") {
    state.sirenContext = new AudioContextClass();
  }

  if (state.sirenContext.state === "suspended") {
    await state.sirenContext.resume();
  }
}

function restartAlarmSequence() {
  stopSiren();
  elements.alarmAudio.pause();
  elements.alarmAudio.currentTime = 0;

  if (state.settings.soundMode === "silent") {
    elements.alarmState.textContent = "Visual only";
    return;
  }

  elements.alarmState.textContent = "Siren";
  playSiren();

  if (state.settings.soundMode !== "full") {
    return;
  }

  state.sirenTimeoutId = window.setTimeout(() => {
    const playPromise = elements.alarmAudio.play();
    if (playPromise) {
      playPromise
        .then(() => {
          elements.alarmState.textContent = "Playing";
        })
        .catch((error) => {
          console.error("Alarm playback failed:", error);
          elements.alarmState.textContent = "Tap Start again";
          state.alarmReady = false;
        });
    }
  }, SIREN_DURATION_MS);
}

function playSiren() {
  const context = state.sirenContext;
  if (!context) {
    return;
  }

  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const now = context.currentTime;

  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(740, now);
  oscillator.frequency.linearRampToValueAtTime(980, now + 0.22);
  oscillator.frequency.linearRampToValueAtTime(740, now + 0.44);
  oscillator.frequency.linearRampToValueAtTime(980, now + 0.66);
  oscillator.frequency.linearRampToValueAtTime(740, now + 0.88);

  gainNode.gain.setValueAtTime(0.001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
  gainNode.gain.exponentialRampToValueAtTime(0.06, now + 0.82);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.9);
}

function stopSiren() {
  if (state.sirenTimeoutId) {
    window.clearTimeout(state.sirenTimeoutId);
    state.sirenTimeoutId = null;
  }
}

function syncCanvasSize() {
  const width = elements.video.videoWidth;
  const height = elements.video.videoHeight;

  if (!width || !height) {
    return;
  }

  if (elements.canvas.width !== width) {
    elements.canvas.width = width;
  }

  if (elements.canvas.height !== height) {
    elements.canvas.height = height;
  }
}

function clearOverlay() {
  const context = elements.canvas.getContext("2d");
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
}

function setStatus(text, isDanger = false) {
  elements.statusText.textContent = text;
  elements.statusText.className = `status-value ${isDanger ? "status-danger" : "status-safe"}`;
  if (elements.statusMeta) {
    elements.statusMeta.textContent = isDanger
      ? "Risk condition confirmed. Alerting sequence is active."
      : text === "Loading model"
        ? "Preparing the AI detector and camera feed."
        : text === "Scanning"
          ? "Protected zone is live and actively being monitored."
          : "Protected zone is clear and the detector is idle.";
  }
  if (elements.safetyBadge) {
    elements.safetyBadge.textContent = isDanger ? text : "Safe";
    elements.safetyBadge.className = `safety-badge ${isDanger ? "safety-danger" : "safety-safe"}`;
  }
}

function resetAlertPlayback() {
  elements.alarmAudio.pause();
  elements.alarmAudio.currentTime = 0;
  stopSiren();
  state.lastAlertAt = 0;
  if (state.alarmReady) {
    elements.alarmState.textContent = "Armed";
  }
}

function setIdleAlertUi() {
  document.body.classList.remove("alert-mode");
  elements.alertBanner.classList.remove("visible");
  if (state.alarmReady) {
    elements.alarmState.textContent = "Armed";
  }
}

function startSessionStats() {
  state.session.startedAt = Date.now();
  state.session.alertCount = 0;
  state.session.longestCleanMs = 0;
  state.session.cleanSinceMs = Date.now();
  elements.alertCountValue.textContent = "0";
  elements.longestStreakValue.textContent = "00:00";
  elements.sessionTimeValue.textContent = "00:00";

  if (state.session.timerId) {
    window.clearInterval(state.session.timerId);
  }
  state.session.timerId = window.setInterval(updateSessionTimeDisplay, 1000);
}

function stopSessionStats() {
  if (state.session.timerId) {
    window.clearInterval(state.session.timerId);
    state.session.timerId = null;
  }
  state.session.startedAt = null;
  state.session.cleanSinceMs = null;
}

function updateSessionTimeDisplay() {
  if (!state.session.startedAt) {
    return;
  }
  elements.sessionTimeValue.textContent = formatDuration(Date.now() - state.session.startedAt);

  let currentLongest = state.session.longestCleanMs;
  if (state.session.cleanSinceMs !== null) {
    currentLongest = Math.max(currentLongest, Date.now() - state.session.cleanSinceMs);
  }
  elements.longestStreakValue.textContent = formatDuration(currentLongest);
}

function registerAlertTriggered() {
  if (state.session.cleanSinceMs !== null) {
    const cleanDuration = Date.now() - state.session.cleanSinceMs;
    state.session.longestCleanMs = Math.max(state.session.longestCleanMs, cleanDuration);
    state.session.cleanSinceMs = null;
  }
  state.session.alertCount += 1;
  elements.alertCountValue.textContent = String(state.session.alertCount);
}

function markCleanStreakStart() {
  if (state.session.cleanSinceMs !== null) {
    return;
  }
  state.session.cleanSinceMs = Date.now();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ── Day theme ──────────────────────────────────────────────────────────────

function applyDayTheme() {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  document.body.setAttribute("data-theme", days[new Date().getDay()]);
}

// ── Focus timer ────────────────────────────────────────────────────────────

const timerEl = {
  display:       document.getElementById("timerDisplay"),
  presetButtons: document.querySelectorAll(".timer-preset-btn"),
  customInput:   document.getElementById("timerCustomInput"),
  startButton:   document.getElementById("timerStartButton"),
  stopButton:    document.getElementById("timerStopButton"),
  alert:         document.getElementById("timerAlert"),
  alertDismiss:  document.getElementById("timerAlertDismiss"),
};

const timerState = {
  totalSeconds:   25 * 60,
  remainingSeconds: 25 * 60,
  intervalId:     null,
  running:        false,
};

initTimer();

function initTimer() {
  timerEl.presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (timerState.running) return;
      const minutes = Number(btn.dataset.minutes);
      setTimerDuration(minutes);
      timerEl.presetButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      timerEl.customInput.value = "";
    });
  });

  timerEl.customInput.addEventListener("change", () => {
    if (timerState.running) return;
    const val = Math.min(300, Math.max(1, Number(timerEl.customInput.value) || 25));
    timerEl.customInput.value = val;
    setTimerDuration(val);
    timerEl.presetButtons.forEach((b) => b.classList.remove("active"));
  });

  timerEl.startButton.addEventListener("click", () => {
    if (timerState.running) return;
    startTimer();
  });

  timerEl.stopButton.addEventListener("click", resetTimer);
  timerEl.alertDismiss.addEventListener("click", dismissTimerAlert);

  updateTimerDisplay();
}

function setTimerDuration(minutes) {
  timerState.totalSeconds = minutes * 60;
  timerState.remainingSeconds = timerState.totalSeconds;
  updateTimerDisplay();
}

function startTimer() {
  timerState.running = true;
  timerEl.display.classList.add("running");
  timerEl.startButton.disabled = true;
  timerEl.stopButton.disabled = false;
  timerEl.presetButtons.forEach((b) => { b.disabled = true; });
  timerEl.customInput.disabled = true;

  timerState.intervalId = window.setInterval(timerTick, 1000);
}

function timerTick() {
  timerState.remainingSeconds -= 1;
  updateTimerDisplay();
  if (timerState.remainingSeconds <= 0) {
    onTimerComplete();
  }
}

function onTimerComplete() {
  window.clearInterval(timerState.intervalId);
  timerState.intervalId = null;
  timerState.running = false;

  if (state.isRunning) {
    stopDetection();
  }

  timerEl.display.classList.remove("running");
  timerEl.alert.classList.remove("hidden");

  if (navigator.vibrate) {
    navigator.vibrate([300, 100, 300, 100, 300]);
  }
}

function resetTimer() {
  if (timerState.intervalId) {
    window.clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
  timerState.running = false;
  timerState.remainingSeconds = timerState.totalSeconds;

  timerEl.display.classList.remove("running");
  timerEl.startButton.disabled = false;
  timerEl.stopButton.disabled = true;
  timerEl.presetButtons.forEach((b) => { b.disabled = false; });
  timerEl.customInput.disabled = false;

  updateTimerDisplay();
}

function dismissTimerAlert() {
  timerEl.alert.classList.add("hidden");
  resetTimer();
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  timerEl.display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ── Live clock ─────────────────────────────────────────────────────────────

(function initClock() {
  const displayEl = document.getElementById("clockDisplay");
  const amPmEl    = document.getElementById("clockAmPm");
  if (!displayEl) return;

  const indiaTimeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  function tick() {
    const parts = Object.fromEntries(
      indiaTimeFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
    );
    displayEl.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
    amPmEl.textContent = parts.dayPeriod;
  }

  tick();
  setInterval(tick, 1000);
})();
