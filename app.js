// Konfigurasi Utama Aplikasi
const APP_CONFIG = {
  trialDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 Hari (72 Jam)
  minSongDurationSec: 30,                   // Minimal 30 detik
  maxSongDurationSec: 10 * 60,              // Maksimal 10 menit (600 detik)
  storageKeyPrefix: 'zenbeat_v1_',
  levels: {
    easy: {
      name: 'Mode Santuy',
      color: '#38bdf8',
      rgb: '56, 189, 248',
      speed: 280,
      cooldown: 640,
      doubleChance: 0,
      beatThreshold: 175,
      missDamage: 7
    },
    normal: {
      name: 'Mode Biasa Aja',
      color: '#34d399',
      rgb: '52, 211, 153',
      speed: 390,
      cooldown: 420,
      doubleChance: 0.06,
      beatThreshold: 160,
      missDamage: 9
    },
    hard: {
      name: 'Mode Sistem Kebut Semalam (SKS)',
      color: '#fb923c',
      rgb: '251, 146, 60',
      speed: 520,
      cooldown: 235,
      doubleChance: 0.16,
      beatThreshold: 145,
      missDamage: 10
    },
    extreme: {
      name: 'Mode WNI',
      color: '#f43f5e',
      rgb: '244, 63, 94',
      speed: 660,
      cooldown: 145,
      doubleChance: 0.35,
      beatThreshold: 132,
      missDamage: 12
    }
  }
};

// State Aplikasi
const appState = {
  deviceId: null,
  firstLaunch: null,
  isActivated: false,
  selectedSource: 'builtin',
  selectedSongId: 'lofi-chill',
  selectedSongTitle: 'Hujan Sore di Kantor',
  selectedSongBpm: 95,
  localAudioBlob: null, // Menyimpan Blob/File lagu lokal yang siap dimainkan
  selectedLevel: 'easy',
  audioOffset: 0
};

// --- 1. INDEXEDDB (LISENSI + PENYIMPANAN FILE AUDIO LOKAL UNTUK HISTORY) ---
function openAppDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZenBeatAppDB', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'title' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPersistedValue(key) {
  const localVal = localStorage.getItem(APP_CONFIG.storageKeyPrefix + key);
  try {
    const db = await openAppDB();
    return new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => {
        const idbVal = req.result ? req.result.value : null;
        if (key === 'firstLaunch' && localVal && idbVal) {
          resolve(Math.min(Number(localVal), Number(idbVal)));
        } else {
          resolve(idbVal || localVal);
        }
      };
      req.onerror = () => resolve(localVal);
    });
  } catch {
    return localVal;
  }
}

async function setPersistedValue(key, value) {
  localStorage.setItem(APP_CONFIG.storageKeyPrefix + key, String(value));
  try {
    const db = await openAppDB();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
  } catch (err) {
    console.warn('IndexedDB fallback:', err);
  }
}

async function saveSongBlobToDB(title, blob) {
  try {
    const db = await openAppDB();
    const tx = db.transaction('songs', 'readwrite');
    tx.objectStore('songs').put({ title, blob, savedAt: Date.now() });
  } catch (err) {
    console.warn('Gagal menyimpan audio lokal ke IndexedDB:', err);
  }
}

async function getSongBlobFromDB(title) {
  try {
    const db = await openAppDB();
    return new Promise((resolve) => {
      const tx = db.transaction('songs', 'readonly');
      const req = tx.objectStore('songs').get(title);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function generateDeviceId() {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  return `ZB-${randomPart}-${timePart}`;
}

async function initTrialAndDevice() {
  let deviceId = await getPersistedValue('deviceId');
  if (!deviceId) {
    deviceId = generateDeviceId();
    await setPersistedValue('deviceId', deviceId);
  }
  appState.deviceId = deviceId;

  let firstLaunch = await getPersistedValue('firstLaunch');
  if (!firstLaunch) {
    firstLaunch = Date.now();
    await setPersistedValue('firstLaunch', firstLaunch);
  }
  appState.firstLaunch = Number(firstLaunch);

  const activated = await getPersistedValue('isActivated');
  appState.isActivated = activated === 'true' || activated === true;

  const savedOffset = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'offset');
  if (savedOffset) {
    appState.audioOffset = Number(savedOffset);
    document.getElementById('offsetSlider').value = appState.audioOffset;
    document.getElementById('offsetValue').textContent = appState.audioOffset;
  }

  document.getElementById('deviceIdDisplay').textContent = deviceId;
  document.getElementById('paywallDeviceId').textContent = deviceId;

  updateTrialUI();
  renderLocalHistory();
}

function updateTrialUI() {
  const badge = document.getElementById('trialBadge');
  if (appState.isActivated) {
    badge.textContent = '★ Versi Permanen';
    badge.classList.add('activated');
    return true;
  }

  const elapsed = Date.now() - appState.firstLaunch;
  const remaining = APP_CONFIG.trialDurationMs - elapsed;

  if (remaining <= 0) {
    badge.textContent = 'Trial Habis';
    document.getElementById('paywallModal').classList.remove('hidden');
    return false;
  }

  const hoursLeft = Math.floor(remaining / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);
  const remHours = hoursLeft % 24;

  badge.textContent = `Trial: ${daysLeft}h ${remHours}j tersisa`;
  return true;
}

// --- 2. SISTEM PREVIEW MUSIK & VALIDASI DURASI ---
const previewManager = {
  audioEl: null,
  audioCtx: null,
  timer: null,
  url: null,

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  },

  playBuiltinPreview(songId, bpm) {
    this.stop();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    const now = this.audioCtx.currentTime;
    const beatSec = 60 / bpm;

    const previewNotes = {
      'lofi-chill': [261.63, 329.63, 392.00, 493.88, 392.00, 329.63],
      'night-drive': [146.83, 220.00, 293.66, 349.23, 293.66, 220.00],
      'coffee-rush': [164.81, 246.94, 329.63, 392.00, 493.88, 392.00]
    };

    const notes = previewNotes[songId] || previewNotes['lofi-chill'];
    notes.forEach((freq, idx) => {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = songId === 'lofi-chill' ? 'sine' : 'triangle';
      const startTime = now + idx * (beatSec * 0.65);
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.06, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + beatSec * 0.8);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + beatSec * 0.85);
    });

    this.timer = setTimeout(() => this.stop(), 4000);
  },

  playLocalPreview(blob) {
    this.stop();
    if (!blob) return;
    this.url = URL.createObjectURL(blob);
    this.audioEl = new Audio(this.url);
    this.audioEl.volume = 0.65;

    this.audioEl.addEventListener('loadedmetadata', () => {
      // Lompat ke sekitar 20% durasi lagu agar langsung terdengar bagian musiknya
      if (this.audioEl && this.audioEl.duration > 15) {
        this.audioEl.currentTime = Math.min(this.audioEl.duration * 0.2, 30);
      }
      this.audioEl.play().catch(() => {});
    });

    this.timer = setTimeout(() => this.stop(), 6000);
  }
};

function checkAudioDuration(blob) {
  return new Promise((resolve) => {
    const tempUrl = URL.createObjectURL(blob);
    const tempAudio = new Audio(tempUrl);
    tempAudio.addEventListener('loadedmetadata', () => {
      const duration = tempAudio.duration;
      URL.revokeObjectURL(tempUrl);
      resolve(duration);
    });
    tempAudio.addEventListener('error', () => {
      URL.revokeObjectURL(tempUrl);
      resolve(0);
    });
  });
}

// --- 3. MANAJEMEN RIWAYAT & HIGHEST SCORE LAGU LOKAL ---
function getLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'local_history')) || [];
  } catch {
    return [];
  }
}

function saveLocalSongRecord(title, levelKey, newScore) {
  const history = getLocalHistory();
  const existingIdx = history.findIndex((item) => item.title === title);
  let highScore = newScore;

  if (existingIdx !== -1) {
    highScore = Math.max(history[existingIdx].highScore, newScore);
    history.splice(existingIdx, 1);
  }

  history.unshift({
    title,
    levelKey,
    highScore,
    updatedAt: Date.now()
  });

  localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'local_history', JSON.stringify(history.slice(0, 15)));
  renderLocalHistory();
  return highScore;
}

function renderLocalHistory() {
  const history = getLocalHistory();
  const wrapper = document.getElementById('localHistoryWrapper');
  const listEl = document.getElementById('localHistoryList');

  if (history.length === 0) {
    wrapper.classList.add('hidden');
    return;
  }

  wrapper.classList.remove('hidden');
  listEl.innerHTML = '';

  history.forEach((item) => {
    const lvl = APP_CONFIG.levels[item.levelKey] || APP_CONFIG.levels.easy;
    const isSelected = appState.selectedSource === 'local' && appState.selectedSongTitle === item.title;

    const div = document.createElement('div');
    div.className = `history-item ${isSelected ? 'active-history' : ''}`;
    div.innerHTML = `
      <div class="history-left">
        <strong>🎵 ${item.title}</strong>
        <span class="history-mode-tag" style="color: ${lvl.color}">${lvl.name}</span>
      </div>
      <div class="history-right">
        <small>HIGHEST SCORE</small>
        <strong>${item.highScore.toLocaleString('id-ID')}</strong>
      </div>
    `;

    // Klik riwayat: otomatis pilih lagu tersebut, muat audio dari IndexedDB, dan putar preview!
    div.addEventListener('click', async () => {
      const savedBlob = await getSongBlobFromDB(item.title);
      if (!savedBlob) {
        alert('File audio tidak ditemukan di memori aplikasi. Silakan pilih ulang file lagunya.');
        document.getElementById('audioFileInput').click();
        return;
      }

      appState.selectedSource = 'local';
      appState.localAudioBlob = savedBlob;
      appState.selectedSongTitle = item.title;

      // Pilih level sesuai riwayat terakhir lagu tersebut
      document.querySelectorAll('.level-card').forEach((c) => c.classList.remove('selected'));
      const targetCard = document.querySelector(`.level-card[data-level="${item.levelKey}"]`);
      if (targetCard) {
        targetCard.classList.add('selected');
        appState.selectedLevel = item.levelKey;
        applyThemeColor(item.levelKey);
      }

      const box = document.getElementById('uploadBoxLabel');
      box.classList.add('has-file');
      document.getElementById('uploadedFileName').textContent = `✅ ${item.title}`;

      renderLocalHistory();
      previewManager.playLocalPreview(savedBlob);
    });

    listEl.appendChild(div);
  });
}

// --- 4. MESIN GAME, LIFE BAR, PAUSE & 4 TIER FEEDBACK ---
class RhythmEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.isPaused = false;
    this.animFrameId = null;

    // Audio
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.audioEl = null;
    this.localObjectUrl = null;
    this.synthInterval = null;
    this.synthStep = 0;

    // Visual & Juice Effects
    this.notes = [];
    this.particles = [];
    this.shockwaves = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.padPressScale = [1, 1, 1, 1];
    this.comboPulse = 1;
    this.shakeIntensity = 0;
    this.visualizerBars = new Array(16).fill(0);

    // Timing
    this.lastSpawnTime = 0;
    this.lastFrameTime = 0;
    this.lastEnergy = 0;
    this.builtinElapsedSec = 0;
    this.songDuration = 45;

    // Skor, Nyawa & Streaks
    this.life = 100;
    this.score = 0;
    this.combo = 0;
    this.perfectStreak = 0;
    this.missStreak = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.badCount = 0;
    this.missCount = 0;

    this.bindInputs();
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.hitLineY = this.height - 92;
  }

  bindInputs() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isRunning || this.isPaused) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const lane = Math.floor(x / (this.width / 4));
      if (lane >= 0 && lane < 4) {
        this.handleLaneHit(lane);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isRunning || this.isPaused || e.repeat) return;
      const keyMap = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
      if (keyMap[e.code] !== undefined) {
        this.handleLaneHit(keyMap[e.code]);
      }
    });
  }

  runCountdown() {
    return new Promise((resolve) => {
      const overlay = document.getElementById('countdownOverlay');
      const textEl = document.getElementById('countdownText');
      const steps = ['3', '2', '1'];
      let idx = 0;

      overlay.classList.remove('hidden');
      textEl.textContent = steps[idx];
      textEl.style.animation = 'none';
      void textEl.offsetWidth;
      textEl.style.animation = 'popScale 0.55s ease-out';

      const timer = setInterval(() => {
        idx++;
        if (idx < steps.length) {
          textEl.textContent = steps[idx];
          textEl.style.animation = 'none';
          void textEl.offsetWidth;
          textEl.style.animation = 'popScale 0.55s ease-out';
        } else {
          clearInterval(timer);
          overlay.classList.add('hidden');
          resolve();
        }
      }, 650);
    });
  }

  async start() {
    previewManager.stop();
    this.stop();
    this.resizeCanvas();

    // Reset State
    this.notes = [];
    this.particles = [];
    this.shockwaves = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.padPressScale = [1, 1, 1, 1];
    this.life = 100;
    this.score = 0;
    this.combo = 0;
    this.perfectStreak = 0;
    this.missStreak = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.badCount = 0;
    this.missCount = 0;
    this.lastSpawnTime = 0;
    this.lastEnergy = 0;
    this.builtinElapsedSec = 0;
    this.synthStep = 0;

    this.updateScoreHUD();
    this.updateLifeUI();

    this.draw();
    await this.runCountdown();

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    if (appState.selectedSource === 'local' && appState.localAudioBlob) {
      await this.setupLocalAudio(appState.localAudioBlob);
    } else {
      this.setupBuiltinSynth(appState.selectedSongId, appState.selectedSongBpm);
    }

    this.isRunning = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  pause() {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.synthInterval) clearInterval(this.synthInterval);
    if (this.audioEl) this.audioEl.pause();
    document.getElementById('pauseModal').classList.remove('hidden');
  }

  async resume() {
    if (!this.isRunning || !this.isPaused) return;
    document.getElementById('pauseModal').classList.add('hidden');
    await this.runCountdown();

    this.isPaused = false;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    if (this.audioEl) {
      await this.audioEl.play();
    } else {
      this.startBuiltinInterval(appState.selectedSongId, appState.selectedSongBpm);
    }

    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  async setupLocalAudio(blob) {
    this.localObjectUrl = URL.createObjectURL(blob);
    this.audioEl = new Audio(this.localObjectUrl);
    this.audioEl.crossOrigin = 'anonymous';

    const source = this.audioCtx.createMediaElementSource(this.audioEl);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 128;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.audioEl.addEventListener('ended', () => this.finishGame(false));
    await this.audioEl.play();
    this.songDuration = this.audioEl.duration || 120;
  }

  setupBuiltinSynth(songId, bpm) {
    this.songDuration = 45;
    this.startBuiltinInterval(songId, bpm);
  }

  startBuiltinInterval(songId, bpm) {
    const beatMs = (60 / bpm) * 1000;
    const chordsMap = {
      'lofi-chill': [
        [261.63, 329.63, 392.00, 493.88],
        [220.00, 261.63, 329.63, 392.00],
        [174.61, 220.00, 261.63, 349.23],
        [196.00, 246.94, 293.66, 392.00]
      ],
      'night-drive': [
        [146.83, 220.00, 293.66, 349.23],
        [116.54, 174.61, 233.08, 293.66],
        [130.81, 196.00, 261.63, 329.63],
        [110.00, 164.81, 220.00, 261.63]
      ],
      'coffee-rush': [
        [164.81, 246.94, 329.63, 392.00],
        [130.81, 196.00, 261.63, 329.63],
        [196.00, 246.94, 293.66, 392.00],
        [146.83, 220.00, 293.66, 369.99]
      ]
    };

    const chords = chordsMap[songId] || chordsMap['lofi-chill'];

    const playStep = () => {
      if (!this.isRunning || this.isPaused) return;
      const now = this.audioCtx.currentTime;
      const chord = chords[Math.floor(this.synthStep / 4) % chords.length];

      for (let i = 0; i < this.visualizerBars.length; i++) {
        this.visualizerBars[i] = 25 + Math.random() * 85;
      }

      if (this.synthStep % 4 === 0) {
        chord.forEach((freq) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = songId === 'lofi-chill' ? 'sine' : 'triangle';
          osc.frequency.setValueAtTime(freq, now);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + (beatMs / 1000) * 3.8);

          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now);
          osc.stop(now + (beatMs / 1000) * 4);
        });
      }

      const kickOsc = this.audioCtx.createOscillator();
      const kickGain = this.audioCtx.createGain();
      kickOsc.type = 'sine';
      kickOsc.frequency.setValueAtTime(125, now);
      kickOsc.frequency.exponentialRampToValueAtTime(42, now + 0.14);

      kickGain.gain.setValueAtTime(0.18, now);
      kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      kickOsc.connect(kickGain);
      kickGain.connect(this.audioCtx.destination);
      kickOsc.start(now);
      kickOsc.stop(now + 0.17);

      const noteFreq = chord[this.synthStep % chord.length] * 2;
      const melOsc = this.audioCtx.createOscillator();
      const melGain = this.audioCtx.createGain();
      melOsc.type = 'sine';
      melOsc.frequency.setValueAtTime(noteFreq, now);
      melGain.gain.setValueAtTime(0.04, now);
      melGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      melOsc.connect(melGain);
      melGain.connect(this.audioCtx.destination);
      melOsc.start(now);
      melOsc.stop(now + 0.26);

      this.trySpawnBeatNote(performance.now(), true);
      this.synthStep++;
    };

    playStep();
    this.synthInterval = setInterval(playStep, beatMs);
  }

  // Sound Effect Khusus Perfect, Good/Bad, dan Miss
  playSoundEffect(type) {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    if (type === 'perfect') {
      // Suara lonceng kristal cerah
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.06); // E6
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.095);
    } else if (type === 'miss') {
      // Suara rendah tumpul saat meleset
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(65, now + 0.14);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } else {
      // Suara tap netral untuk Good / Bad
      osc.type = 'sine';
      osc.frequency.setValueAtTime(580, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.045);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.055);
    }
  }

  trySpawnBeatNote(now, forceBeat = false) {
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    if (now - this.lastSpawnTime < levelCfg.cooldown) return;

    let isBeat = forceBeat;

    if (!forceBeat && this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
      let bassSum = 0;
      for (let i = 1; i <= 10; i++) {
        bassSum += this.dataArray[i];
      }
      const bassAvg = bassSum / 10;

      for (let i = 0; i < this.visualizerBars.length; i++) {
        this.visualizerBars[i] = (this.dataArray[i * 2] || 0) * 0.65;
      }

      if (bassAvg > levelCfg.beatThreshold && bassAvg > this.lastEnergy + 8) {
        isBeat = true;
      }
      this.lastEnergy = bassAvg * 0.92;
    }

    if (isBeat) {
      this.lastSpawnTime = now;
      const lane1 = Math.floor(Math.random() * 4);
      this.notes.push({ lane: lane1, y: -30, hit: false });

      if (Math.random() < levelCfg.doubleChance) {
        let lane2 = (lane1 + 1 + Math.floor(Math.random() * 3)) % 4;
        this.notes.push({ lane: lane2, y: -30, hit: false });
      }
    }
  }

  handleLaneHit(lane) {
    this.laneFlashes[lane] = 1.0;
    this.padPressScale[lane] = 0.86;

    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    let closestNote = null;
    let minDiff = Infinity;

    for (const note of this.notes) {
      if (note.lane === lane && !note.hit) {
        const diff = Math.abs(note.y - targetY);
        if (diff < minDiff) {
          minDiff = diff;
          closestNote = note;
        }
      }
    }

    if (closestNote && minDiff <= 105) {
      closestNote.hit = true;
      this.missStreak = 0;

      if (minDiff <= 40) {
        // PERFECT (Biru Cyan - Naik ke atas goyang-goyang + x25 membesar)
        this.score += 100 + this.combo * 5;
        this.combo++;
        this.perfectStreak++;
        this.perfectCount++;

        let heal = 2;
        if (this.combo % 10 === 0) heal += 5;
        this.life = Math.min(100, this.life + heal);

        const isMilestone = this.perfectStreak >= 25 && this.perfectStreak % 25 === 0;
        const label = this.perfectStreak > 1 ? `PERFECT x${this.perfectStreak}` : 'PERFECT!';
        this.showFeedback(label, isMilestone ? 'anim-perfect-milestone' : 'anim-perfect');
        this.playSoundEffect('perfect');

        this.shakeIntensity = isMilestone ? 6.5 : (appState.selectedLevel === 'extreme' ? 4 : 1.8);
        if (navigator.vibrate) navigator.vibrate(isMilestone ? 30 : 15);
      } else if (minDiff <= 74) {
        // GOOD (Hijau - Naik mulus dari bawah ke atas)
        this.score += 50 + this.combo * 2;
        this.combo++;
        this.perfectStreak = 0;
        this.goodCount++;

        if (this.combo % 10 === 0) {
          this.life = Math.min(100, this.life + 3);
        }

        this.showFeedback('GOOD', 'anim-good');
        this.playSoundEffect('tap');
      } else {
        // BAD (Merah Muda - Goyang di tempat saja)
        this.score += 15;
        this.combo = 0;
        this.perfectStreak = 0;
        this.badCount++;

        this.showFeedback('BAD', 'anim-bad');
        this.playSoundEffect('tap');
      }

      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.comboPulse = 1.35;
      this.spawnHitEffects(lane);
      this.updateScoreHUD();
      this.updateLifeUI();
    }
  }

  showFeedback(text, animClass) {
    const el = document.getElementById('hitFeedback');
    el.textContent = text;
    el.className = 'hit-feedback'; // Reset semua kelas animasi
    void el.offsetWidth;
    el.classList.add(animClass);
  }

  spawnHitEffects(lane) {
    const laneW = this.width / 4;
    const cx = lane * laneW + laneW / 2;
    const levelColor = APP_CONFIG.levels[appState.selectedLevel].color;

    this.shockwaves.push({
      x: cx,
      y: this.hitLineY,
      radius: 18,
      alpha: 0.9,
      color: levelColor
    });

    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: cx,
        y: this.hitLineY,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.85) * 260,
        size: 3 + Math.random() * 3,
        alpha: 1,
        color: levelColor
      });
    }
  }

  updateScoreHUD() {
    document.getElementById('scoreDisplay').textContent = this.score;
  }

  updateLifeUI() {
    const fillEl = document.getElementById('lifeBarFill');
    const textEl = document.getElementById('lifePercentText');
    const clamped = Math.max(0, Math.round(this.life));

    fillEl.style.width = `${clamped}%`;
    textEl.textContent = `${clamped}%`;

    if (clamped <= 30) {
      fillEl.classList.add('danger');
      textEl.style.color = '#f43f5e';
    } else {
      fillEl.classList.remove('danger');
      textEl.style.color = '#f8fafc';
    }
  }

  loop(timestamp) {
    if (!this.isRunning || this.isPaused) return;

    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    // Update Progress Lagu
    let elapsedSec = 0;
    if (this.audioEl && !isNaN(this.audioEl.duration)) {
      elapsedSec = this.audioEl.currentTime;
      this.songDuration = this.audioEl.duration;
    } else {
      this.builtinElapsedSec += dt;
      elapsedSec = this.builtinElapsedSec;
    }

    const progressPct = Math.min(100, (elapsedSec / this.songDuration) * 100);
    document.getElementById('songProgressBar').style.width = `${progressPct}%`;

    if (elapsedSec >= this.songDuration) {
      this.finishGame(false);
      return;
    }

    if (appState.selectedSource === 'local') {
      this.trySpawnBeatNote(timestamp, false);
    }

    // Update Posisi Balok
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    for (const note of this.notes) {
      if (!note.hit) {
        note.y += levelCfg.speed * dt;
        if (note.y > this.height + 24) {
          note.hit = true;
          this.combo = 0;
          this.perfectStreak = 0;
          this.missCount++;
          this.missStreak++;
          this.comboPulse = 1.25;
          this.shakeIntensity = 5;

          this.life = Math.max(0, this.life - levelCfg.missDamage);
          this.updateLifeUI();
          this.playSoundEffect('miss');

          const missLabel = this.missStreak > 1 ? `MISS x${this.missStreak}` : 'MISS';
          this.showFeedback(missLabel, 'anim-miss');
          this.updateScoreHUD();

          if (this.life <= 0) {
            this.finishGame(true);
            return;
          }
        }
      }
    }
    this.notes = this.notes.filter((n) => !n.hit);

    // Decay animasi visual
    for (let i = 0; i < 4; i++) {
      this.laneFlashes[i] = Math.max(0, this.laneFlashes[i] - dt * 4.5);
      this.padPressScale[i] += (1 - this.padPressScale[i]) * Math.min(1, dt * 18);
    }

    for (let i = 0; i < this.visualizerBars.length; i++) {
      this.visualizerBars[i] = Math.max(0, this.visualizerBars[i] - dt * 140);
    }

    this.comboPulse += (1 - this.comboPulse) * Math.min(1, dt * 12);
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 25);

    for (const sw of this.shockwaves) {
      sw.radius += dt * 190;
      sw.alpha -= dt * 2.8;
    }
    this.shockwaves = this.shockwaves.filter((s) => s.alpha > 0);

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 2.6;
    }
    this.particles = this.particles.filter((p) => p.alpha > 0);

    this.draw();
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  draw() {
    const ctx = this.ctx;
    const laneW = this.width / 4;
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    const levelColor = levelCfg.color;
    const levelRgb = levelCfg.rgb;

    ctx.save();
    if (this.shakeIntensity > 0.1) {
      const dx = (Math.random() - 0.5) * this.shakeIntensity;
      const dy = (Math.random() - 0.5) * this.shakeIntensity;
      ctx.translate(dx, dy);
    }

    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Audio Visualizer Latar Belakang
    const barCount = this.visualizerBars.length;
    const barW = this.width / barCount;
    for (let i = 0; i < barCount; i++) {
      const barH = this.visualizerBars[i] * 1.4;
      ctx.fillStyle = `rgba(${levelRgb}, 0.08)`;
      ctx.fillRect(i * barW + 2, this.hitLineY - barH, barW - 4, barH);
    }

    // 2. Angka Combo / Miss Streak Besar di Tengah Latar Belakang
    if (this.combo > 1) {
      ctx.save();
      ctx.translate(this.width / 2, this.height * 0.33);
      ctx.scale(this.comboPulse, this.comboPulse);

      ctx.font = '900 84px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = `rgba(${levelRgb}, 0.55)`;
      ctx.lineWidth = 3;
      ctx.strokeText(`${this.combo}`, 0, 0);

      ctx.fillStyle = `rgba(${levelRgb}, 0.34)`;
      ctx.fillText(`${this.combo}`, 0, 0);

      ctx.font = '900 15px sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, 0.45)`;
      ctx.fillText('COMBO', 0, 24);
      ctx.restore();
    } else if (this.missStreak > 1) {
      ctx.save();
      ctx.translate(this.width / 2, this.height * 0.33);
      ctx.scale(this.comboPulse, this.comboPulse);

      ctx.font = '900 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(`${this.missStreak}x`, 0, 0);

      ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
      ctx.fillText(`${this.missStreak}x`, 0, 0);

      ctx.font = '900 14px sans-serif';
      ctx.fillStyle = 'rgba(244, 63, 94, 0.65)';
      ctx.fillText('MISS STREAK', 0, 22);
      ctx.restore();
    }

    // 3. Jalur & Kilauan Sorotan Ketukan
    for (let i = 0; i < 4; i++) {
      const x = i * laneW;
      if (this.laneFlashes[i] > 0) {
        const grad = ctx.createLinearGradient(0, this.hitLineY - 220, 0, this.height);
        grad.addColorStop(0, `rgba(${levelRgb}, 0)`);
        grad.addColorStop(1, `rgba(${levelRgb}, ${this.laneFlashes[i] * 0.34})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, laneW, this.height);
      }

      if (i > 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
        ctx.stroke();
      }
    }

    // 4. Tuts Tombol Bawah (Tactile Pads — Garis horizontal dihilangkan sesuai permintaan)
    const keyLabels = ['D', 'F', 'J', 'K'];
    for (let i = 0; i < 4; i++) {
      const padW = laneW - 14;
      const padH = 54;
      const cx = i * laneW + laneW / 2;
      const cy = this.hitLineY + 12;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(this.padPressScale[i], this.padPressScale[i]);

      ctx.fillStyle = this.laneFlashes[i] > 0.15
        ? `rgba(${levelRgb}, 0.35)`
        : 'rgba(255, 255, 255, 0.04)';
      ctx.strokeStyle = this.laneFlashes[i] > 0.15
        ? '#ffffff'
        : `rgba(${levelRgb}, 0.4)`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.roundRect(-padW / 2, -padH / 2, padW, padH, 14);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(keyLabels[i], 0, 4);
      ctx.restore();
    }

    // 5. Gambar Balok Nada dengan Motion Trail & Kilau
    for (const note of this.notes) {
      const x = note.lane * laneW + 9;
      const w = laneW - 18;
      const h = 30;

      const trailGrad = ctx.createLinearGradient(0, note.y - 75, 0, note.y);
      trailGrad.addColorStop(0, `rgba(${levelRgb}, 0)`);
      trailGrad.addColorStop(1, `rgba(${levelRgb}, 0.28)`);
      ctx.fillStyle = trailGrad;
      ctx.fillRect(x + 4, note.y - 75, w - 8, 75);

      ctx.fillStyle = levelColor;
      ctx.shadowColor = levelColor;
      ctx.shadowBlur = 14;

      ctx.beginPath();
      ctx.roundRect(x, note.y - h / 2, w, h, 10);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.roundRect(x + 8, note.y - 3, w - 16, 6, 3);
      ctx.fill();
    }

    // 6. Shockwave Rings
    for (const sw of this.shockwaves) {
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${levelRgb}, ${Math.max(0, sw.alpha)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 7. Partikel Ledakan Ketukan
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  finishGame(isGameOver = false) {
    this.stop();

    let highScore = this.score;
    if (appState.selectedSource === 'local') {
      highScore = saveLocalSongRecord(appState.selectedSongTitle, appState.selectedLevel, this.score);
    } else {
      const key = `builtin_hs_${appState.selectedSongId}`;
      const prev = Number(localStorage.getItem(APP_CONFIG.storageKeyPrefix + key) || 0);
      highScore = Math.max(prev, this.score);
      localStorage.setItem(APP_CONFIG.storageKeyPrefix + key, String(highScore));
    }

    const rankEl = document.getElementById('resultRank');
    const titleEl = document.getElementById('resultTitle');
    const subEl = document.getElementById('resultSubtitle');

    if (isGameOver) {
      rankEl.textContent = '💀';
      rankEl.classList.add('gameover');
      titleEl.textContent = 'Nyawa Habis (Game Over)!';
      subEl.textContent = 'Cobaan terlalu deras, tarik napas dulu lalu coba lagi!';
    } else {
      rankEl.classList.remove('gameover');
      const totalNotes = this.perfectCount + this.goodCount + this.badCount + this.missCount;
      const accuracy = totalNotes > 0
        ? ((this.perfectCount + this.goodCount * 0.7 + this.badCount * 0.3) / totalNotes) * 100
        : 100;

      let rank = 'C';
      let title = 'Lumayan Buat Lemesin Jari!';
      if (accuracy >= 90) {
        rank = 'S';
        title = 'Luar Biasa! Stres Auto Hilang!';
      } else if (accuracy >= 75) {
        rank = 'A';
        title = 'Mantap! Ritmemu Stabil!';
      } else if (accuracy >= 55) {
        rank = 'B';
        title = 'Cukup Santuy, Coba Lagi Yuk!';
      }

      rankEl.textContent = rank;
      titleEl.textContent = title;
      subEl.textContent = 'Pikiranmu sudah lebih segar sekarang.';
    }

    document.getElementById('finalScore').textContent = this.score.toLocaleString('id-ID');
    document.getElementById('finalHighScore').textContent = highScore.toLocaleString('id-ID');
    document.getElementById('finalMaxCombo').textContent = `${this.maxCombo}x`;
    document.getElementById('finalPerfect').textContent = this.perfectCount;
    document.getElementById('finalGood').textContent = this.goodCount;
    document.getElementById('finalBad').textContent = this.badCount;
    document.getElementById('finalMiss').textContent = this.missCount;

    document.getElementById('resultModal').classList.remove('hidden');
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.synthInterval) clearInterval(this.synthInterval);
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl = null;
    }
    if (this.localObjectUrl) {
      URL.revokeObjectURL(this.localObjectUrl);
      this.localObjectUrl = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}

// --- 5. INTERAKSI UI MENU UTAMA ---
let rhythmEngine = null;

function applyThemeColor(levelKey) {
  const color = APP_CONFIG.levels[levelKey].color;
  document.documentElement.style.setProperty('--active-theme', color);
}

function setupUIEvents() {
  rhythmEngine = new RhythmEngine();

  // Tab Lagu Bawaan vs Lokal
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      previewManager.stop();
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      appState.selectedSource = target;
      document.getElementById(`${target}Tab`).classList.add('active');
    });
  });

  // Pilih Lagu Bawaan + Putar Preview
  document.querySelectorAll('.song-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.song-item').forEach((el) => {
        el.classList.remove('selected');
        el.querySelector('.badge-check').textContent = 'Pilih';
      });
      item.classList.add('selected');
      item.querySelector('.badge-check').textContent = 'Aktif';

      appState.selectedSource = 'builtin';
      appState.selectedSongId = item.dataset.song;
      appState.selectedSongBpm = Number(item.dataset.bpm) || 100;
      appState.selectedSongTitle = item.querySelector('strong').textContent;

      previewManager.playBuiltinPreview(appState.selectedSongId, appState.selectedSongBpm);
    });
  });

  // Upload Lagu Lokal + Validasi Durasi (30 detik - 10 menit) + Simpan ke IndexedDB
  const fileInput = document.getElementById('audioFileInput');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const duration = await checkAudioDuration(file);
    if (duration < APP_CONFIG.minSongDurationSec) {
      alert(`Durasi lagu terlalu pendek (${Math.round(duration)} detik). Minimal durasi lagu adalah 30 detik.`);
      fileInput.value = '';
      return;
    }
    if (duration > APP_CONFIG.maxSongDurationSec) {
      const mins = (duration / 60).toFixed(1);
      alert(`Durasi lagu terlalu panjang (${mins} menit). Maksimal durasi lagu yang bisa dimainkan adalah 10 menit.`);
      fileInput.value = '';
      return;
    }

    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    appState.selectedSource = 'local';
    appState.localAudioBlob = file;
    appState.selectedSongTitle = cleanTitle;

    const box = document.getElementById('uploadBoxLabel');
    box.classList.add('has-file');
    document.getElementById('uploadedFileName').textContent = `✅ ${cleanTitle}`;

    await saveSongBlobToDB(cleanTitle, file);
    saveLocalSongRecord(cleanTitle, appState.selectedLevel, 0);
    previewManager.playLocalPreview(file);
  });

  // Pilih 4 Level Kesulitan
  document.querySelectorAll('.level-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.level-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.selectedLevel = card.dataset.level;
      applyThemeColor(appState.selectedLevel);
    });
  });

  // Tombol Mulai Main
  document.getElementById('startGameBtn').addEventListener('click', async () => {
    if (!updateTrialUI()) return;

    if (appState.selectedSource === 'local' && !appState.localAudioBlob) {
      alert('Pilih file lagu MP3/WAV dari perangkatmu atau dari daftar riwayat terlebih dahulu ya!');
      return;
    }

    const levelInfo = APP_CONFIG.levels[appState.selectedLevel];
    document.getElementById('hudSongTitle').textContent = appState.selectedSongTitle;
    const badge = document.getElementById('hudLevelName');
    badge.textContent = levelInfo.name;
    badge.style.color = levelInfo.color;

    document.getElementById('menuScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('active');

    await rhythmEngine.start();
  });

  // Tombol Pause & Resume
  document.getElementById('pauseGameBtn').addEventListener('click', () => {
    rhythmEngine.pause();
  });

  document.getElementById('resumeGameBtn').addEventListener('click', async () => {
    await rhythmEngine.resume();
  });

  document.getElementById('quitToMenuBtn').addEventListener('click', () => {
    document.getElementById('pauseModal').classList.add('hidden');
    rhythmEngine.stop();
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('menuScreen').classList.add('active');
  });

  // Tombol di Modal Hasil Akhir
  document.getElementById('playAgainBtn').addEventListener('click', async () => {
    document.getElementById('resultModal').classList.add('hidden');
    await rhythmEngine.start();
  });

  document.getElementById('resultMenuBtn').addEventListener('click', () => {
    document.getElementById('resultModal').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('menuScreen').classList.add('active');
  });

  // Modal Pengaturan Kalibrasi Delay
  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('offsetSlider').addEventListener('input', (e) => {
    appState.audioOffset = Number(e.target.value);
    document.getElementById('offsetValue').textContent = appState.audioOffset;
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'offset', String(appState.audioOffset));
    settingsModal.classList.add('hidden');
  });

  // Placeholder Tombol Aktivasi
  document.getElementById('activateBtn').addEventListener('click', () => {
    const code = document.getElementById('licenseInput').value.trim();
    if (!code) {
      alert('Masukkan kode aktivasi dari Lynk.id terlebih dahulu.');
      return;
    }
    alert(`Kode "${code}" siap divalidasi ke Cloudflare Worker pada Tahap 3 & 4!`);
  });
}

// --- 6. PWA SERVICE WORKER & INSTALL PROMPT ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('installBtn');
  installBtn.classList.remove('hidden');

  installBtn.addEventListener('click', async () => {
    installBtn.classList.add('hidden');
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('SW gagal terdaftar:', err);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await initTrialAndDevice();
  setupUIEvents();
});
