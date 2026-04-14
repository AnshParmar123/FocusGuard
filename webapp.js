const elements = {
  video: document.getElementById("camera"),
  canvas: document.getElementById("overlay"),
  emptyState: document.getElementById("emptyState"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  phoneCount: document.getElementById("phoneCount"),
  alarmState: document.getElementById("alarmState"),
  viewerLabel: document.getElementById("viewerLabel"),
  alertBanner: document.getElementById("alertBanner"),
  alarmAudio: document.getElementById("alarmAudio"),
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
  phoneSeenStreak: 0,
  phoneMissingStreak: 0,
  lastPhonePredictions: [],
};

const PHONE_CLASS = "cell phone";
const MIN_SCORE = 0.3;
const DETECTION_INTERVAL_MS = 220;
const ALERT_COOLDOWN_MS = 6000;
const SIREN_DURATION_MS = 900;
const DETECTION_CONFIRM_FRAMES = 2;
const DETECTION_GRACE_FRAMES = 3;
let lastDetectionTime = 0;

elements.startButton.addEventListener("click", startDetection);
elements.stopButton.addEventListener("click", stopDetection);
window.addEventListener("beforeunload", stopDetection);

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
      video: {
        facingMode: { ideal: "environment" },
      },
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
    setStatus("Scanning");
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
  elements.phoneCount.textContent = "0";
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  state.phoneSeenStreak = 0;
  state.phoneMissingStreak = 0;
  state.lastPhonePredictions = [];
  setStatus("Idle");
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
    const predictions = await state.model.detect(elements.video, 20, MIN_SCORE);
    const directPhones = predictions.filter(
      (prediction) => prediction.class === PHONE_CLASS && prediction.score >= MIN_SCORE,
    );
    const stablePhones = stabilizeDetections(directPhones);

    renderDetections(stablePhones);
    maybePlayAlarm(stablePhones.length > 0);
  } catch (error) {
    console.error("Detection error:", error);
    setStatus("Detection paused");
  } finally {
    state.isDetecting = false;
  }
}

function stabilizeDetections(directPhones) {
  if (directPhones.length > 0) {
    state.phoneSeenStreak += 1;
    state.phoneMissingStreak = 0;
    state.lastPhonePredictions = directPhones;
  } else if (state.lastPhonePredictions.length > 0) {
    state.phoneMissingStreak += 1;
  }

  if (state.phoneSeenStreak >= DETECTION_CONFIRM_FRAMES && state.lastPhonePredictions.length > 0) {
    if (directPhones.length > 0) {
      return directPhones;
    }

    if (state.phoneMissingStreak <= DETECTION_GRACE_FRAMES) {
      return state.lastPhonePredictions;
    }
  }

  if (state.phoneMissingStreak > DETECTION_GRACE_FRAMES) {
    state.phoneSeenStreak = 0;
    state.phoneMissingStreak = 0;
    state.lastPhonePredictions = [];
  }

  return [];
}

function renderDetections(phones) {
  const context = elements.canvas.getContext("2d");
  clearOverlay();
  elements.phoneCount.textContent = String(phones.length);

  if (!phones.length) {
    setIdleAlertUi();
    if (state.isRunning) {
      setStatus("Scanning");
      elements.viewerLabel.textContent = "Live detection running";
    }
    return;
  }

  document.body.classList.add("alert-mode");
  elements.alertBanner.classList.add("visible");
  setStatus("Phone detected");
  elements.viewerLabel.textContent = phones.length === 1 ? "1 phone in frame" : `${phones.length} phones in frame`;

  context.lineWidth = 3;
  context.font = '700 18px "Manrope", sans-serif';

  phones.forEach((phone) => {
    const [x, y, width, height] = phone.bbox;
    const label = `Phone ${Math.round(phone.score * 100)}%`;

    context.strokeStyle = "#ff5f6d";
    context.fillStyle = "rgba(255, 95, 109, 0.18)";
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);

    const labelWidth = context.measureText(label).width + 20;
    context.fillStyle = "#ff5f6d";
    context.fillRect(x, Math.max(0, y - 34), labelWidth, 34);
    context.fillStyle = "#ffffff";
    context.fillText(label, x + 10, Math.max(23, y - 11));
  });
}

function maybePlayAlarm(hasPhone) {
  if (!hasPhone || !state.alarmReady) {
    return;
  }

  const now = Date.now();
  if (now - state.lastAlertAt < ALERT_COOLDOWN_MS) {
    return;
  }

  state.lastAlertAt = now;
  restartAlarmSequence();
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
  elements.alarmState.textContent = "Siren";

  playSiren();

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

function setStatus(text) {
  elements.statusText.textContent = text;
}

function setIdleAlertUi() {
  document.body.classList.remove("alert-mode");
  elements.alertBanner.classList.remove("visible");
  if (state.alarmReady) {
    elements.alarmState.textContent = "Armed";
  }
}
