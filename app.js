// Konfigurasi Utama Aplikasi & Lokasi File Audio Server
const APP_CONFIG = {
  trialDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 Hari (72 Jam)
  minSongDurationSec: 30,                   // Minimal 30 detik
  maxSongDurationSec: 10 * 60,              // Maksimal 10 menit (600 detik)
  storageKeyPrefix: 'zenbeat_v1_',
  // Seluruh file audio dikelola dari folder server / proyek Anda
  serverAudio: {
    menuTheme: 'assets/audio/theme-menu.mp3',
    sfx: {
      tap: 'assets/audio/sfx/tap.mp3',
      perfect: 'assets/audio/sfx/perfect.mp3',
      slide: 'assets/audio/sfx/slide.mp3',
      miss: 'assets/audio/sfx/miss.mp3',
      scoreTick: 'assets/audio/sfx/score-tick.mp3'
    },
    bgm: {
      clear: 'assets/audio/bgm/clear.mp3',
      gameover: 'assets/audio/bgm/gameover.mp3'
    }
  },
  levels: {
    easy: {
      name: 'Mode Santuy',
      short: 'EASY',
      color: '#38bdf8',
      rgb: '56, 189, 248',
      speed: 280,
      cooldown: 640,
      doubleChance: 0,
      holdChance: 0.14,
      slideChance: 0.1,
      beatThreshold: 172,
      missDamage: 7
    },
    normal: {
      name: 'Mode Biasa Aja',
      short: 'NORMAL',
      color: '#34d399',
      rgb: '52, 211, 153',
      speed: 390,
      cooldown: 430,
      doubleChance: 0.05,
      holdChance: 0.18,
      slideChance: 0.15,
      beatThreshold: 158,
      missDamage: 9
    },
    hard: {
      name: 'Kebut Semalam',
      short: 'HARD',
      color: '#fb923c',
      rgb: '251, 146, 60',
      speed: 520,
      cooldown: 245,
      doubleChance: 0.14,
      holdChance: 0.22,
      slideChance: 0.18,
      beatThreshold: 144,
      missDamage: 10
    },
    extreme: {
      name: 'Mode WNI',
      short: 'EXTREME',
      color: '#f43f5e',
      rgb: '244, 63, 94',
      speed: 650,
      cooldown: 165,
      doubleChance: 0.28,
      holdChance: 0.22,
      slideChance: 0.22,
      beatThreshold: 130,
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
  selectedSongId: 'hujan-sore',
  selectedSongSrc: 'assets/audio/songs/hujan-sore.mp3',
  selectedSongTitle: 'Hujan Sore di Kantor',
  localAudioBlob: null,
  selectedLevel: 'easy',
  audioOffset: 0,
  sfxEnabled: true,
  bgmEnabled: true
};

// --- 1. INDEXEDDB (LISENSI & LAGU LOKAL) ---
function openAppDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZenBeatAppDB', 4);
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
    console.warn('Gagal menyimpan audio lokal:', err);
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

  const savedSfx = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'sfxEnabled');
  appState.sfxEnabled = savedSfx !== 'false';
  document.getElementById('sfxToggleCheckbox').checked = appState.sfxEnabled;

  document.getElementById('deviceIdDisplay').textContent = deviceId;
  document.getElementById('paywallDeviceId').textContent = deviceId;

  updateTrialUI();
  renderLocalHistory();
}

function updateTrialUI() {
  const badge = document.getElementById('trialBadge');
  if (appState.isActivated) {
    badge.textContent = '★ Permanen';
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

  badge.textContent = `Trial ${daysLeft}h ${remHours}j`;
  return true;
}

// --- 2. SERVER AUDIO MANAGER (THEME SONG, RESULT BGM & SERVER SFX) ---
const serverAudioManager = {
  menuAudio: null,
  resultAudio: null,
  sfxPool: {},

  init() {
    // Siapkan pool SFX dari folder server
    Object.entries(APP_CONFIG.serverAudio.sfx).forEach(([key, src]) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      this.sfxPool[key] = audio;
    });
  },

  startMenuTheme() {
    if (!appState.bgmEnabled) return;
    if (document.getElementById('gameScreen').classList.contains('active')) return;
    this.stopResultMusic();

    if (!this.menuAudio) {
      this.menuAudio = new Audio(APP_CONFIG.serverAudio.menuTheme);
      this.menuAudio.loop = true;
      this.menuAudio.volume = 0.55;
    }
    this.menuAudio.play().catch(() => {});
  },

  stopMenuTheme() {
    if (this.menuAudio) {
      this.menuAudio.pause();
      this.menuAudio.currentTime = 0;
    }
  },

  playResultMusic(isGameOver) {
    this.stopMenuTheme();
    this.stopResultMusic();
    const src = isGameOver
      ? APP_CONFIG.serverAudio.bgm.gameover
      : APP_CONFIG.serverAudio.bgm.clear;

    this.resultAudio = new Audio(src);
    this.resultAudio.volume = 0.7;
    this.resultAudio.play().catch(() => {});
  },

  stopResultMusic() {
    if (this.resultAudio) {
      this.resultAudio.pause();
      this.resultAudio.currentTime = 0;
      this.resultAudio = null;
    }
  },

  playSfx(type, audioCtxFallback = null) {
    if (!appState.sfxEnabled) return;
    const baseAudio = this.sfxPool[type];
    if (baseAudio && baseAudio.readyState >= 2) {
      const clone = baseAudio.cloneNode();
      clone.volume = type === 'scoreTick' ? 0.35 : 0.8;
      clone.play().catch(() => {});
      return;
    }

    // Fallback WebAudio ringan bila file .mp3 belum diunggah ke server
    if (!audioCtxFallback) return;
    const now = audioCtxFallback.currentTime;
    const osc = audioCtxFallback.createOscillator();
    const gain = audioCtxFallback.createGain();
    osc.type = type === 'miss' ? 'sawtooth' : 'triangle';
    const freqMap = { perfect: 1046, slide: 1318, tap: 660, miss: 130, scoreTick: 880 };
    osc.frequency.setValueAtTime(freqMap[type] || 660, now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(audioCtxFallback.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }
};

// Preview Lagu (Baik Lagu Server MP3 maupun Lagu Lokal HP/PC)
const previewManager = {
  audioEl: null,
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
  },

  playPreviewFromSrcOrBlob(source) {
    serverAudioManager.stopMenuTheme();
    this.stop();
    if (!source) return;

    if (source instanceof Blob) {
      this.url = URL.createObjectURL(source);
      this.audioEl = new Audio(this.url);
    } else {
      this.audioEl = new Audio(source);
    }

    this.audioEl.volume = 0.65;
    this.audioEl.addEventListener('loadedmetadata', () => {
      if (this.audioEl && this.audioEl.duration > 15) {
        this.audioEl.currentTime = Math.min(this.audioEl.duration * 0.2, 25);
      }
      this.audioEl.play().catch(() => {});
    });

    // Jika gagal memuat (misalnya file MP3 server belum diupload), kembalikan theme menu
    this.audioEl.addEventListener('error', () => {
      this.stop();
      serverAudioManager.startMenuTheme();
    });

    this.timer = setTimeout(() => {
      this.stop();
      serverAudioManager.startMenuTheme();
    }, 6000);
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

// --- 3. MANAJEMEN RIWAYAT & HIGHEST SCORE PER LEVEL ---
function getLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'local_history_v2')) || [];
  } catch {
    return [];
  }
}

function saveLocalSongRecord(title, levelKey, newScore) {
  const history = getLocalHistory();
  const existingIdx = history.findIndex((item) => item.title === title);

  let scores = { easy: 0, normal: 0, hard: 0, extreme: 0 };
  if (existingIdx !== -1) {
    scores = { ...scores, ...(history[existingIdx].scores || {}) };
    history.splice(existingIdx, 1);
  }

  scores[levelKey] = Math.max(scores[levelKey] || 0, newScore);

  history.unshift({
    title,
    lastLevel: levelKey,
    scores,
    updatedAt: Date.now()
  });

  localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'local_history_v2', JSON.stringify(history.slice(0, 15)));
  renderLocalHistory();
  return scores[levelKey];
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

  const levelKeys = ['easy', 'normal', 'hard', 'extreme'];

  history.forEach((item) => {
    const isSelected = appState.selectedSource === 'local' && appState.selectedSongTitle === item.title;
    const scores = item.scores || { easy: 0, normal: 0, hard: 0, extreme: 0 };

    const badgesHtml = levelKeys.map((lk) => {
      const cfg = APP_CONFIG.levels[lk];
      const val = scores[lk] || 0;
      return `
        <div class="hs-badge">
          <small style="color: ${cfg.color}">${cfg.short}</small>
          <span>${val > 0 ? val.toLocaleString('id-ID') : '-'}</span>
        </div>
      `;
    }).join('');

    const div = document.createElement('div');
    div.className = `history-item ${isSelected ? 'active-history' : ''}`;
    div.innerHTML = `
      <div class="history-title-row">
        <strong>🎵 ${item.title}</strong>
        ${isSelected ? '<span class="history-active-pill">DIPILIH</span>' : ''}
      </div>
      <div class="history-scores-grid">
        ${badgesHtml}
      </div>
    `;

    div.addEventListener('click', async () => {
      const savedBlob = await getSongBlobFromDB(item.title);
      if (!savedBlob) {
        alert('File audio tidak ditemukan di memori perangkat. Silakan pilih ulang file lagunya.');
        document.getElementById('audioFileInput').click();
        return;
      }

      appState.selectedSource = 'local';
      appState.localAudioBlob = savedBlob;
      appState.selectedSongTitle = item.title;

      document.getElementById('uploadedFileName').textContent = `✅ ${item.title}`;
      renderLocalHistory();
      previewManager.playPreviewFromSrcOrBlob(savedBlob);
    });

    listEl.appendChild(div);
  });
}

// --- 4. MESIN GAME (REAL-TIME BEAT SYNC PULSE, 2-LANE SLIDE & GRADE SSS-F) ---
class RhythmEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.isPaused = false;
    this.animFrameId = null;

    // Audio & Real-Time Beat Analyser
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.audioEl = null;
    this.localObjectUrl = null;

    // Visual & Real-Time Beat Pulse
    this.notes = [];
    this.particles = [];
    this.shockwaves = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.padPressScale = [1, 1, 1, 1];
    this.comboPulse = 1;
    this.beatPulse = 0; // 100% dikendalikan oleh energi bass beat lagu asli
    this.shakeIntensity = 0;
    this.visualizerBars = new Array(16).fill(0);

    // Input Tracking
    this.activeTouches = new Map();
    this.activeKeys = new Set();

    // Timing & Energy Tracking
    this.lastSpawnTime = 0;
    this.lastFrameTime = 0;
    this.lastBassEnergy = 0;
    this.songDuration = 60;

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
      this.canvas.setPointerCapture(e.pointerId);

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const lane = Math.floor(x / (this.width / 4));

      if (lane >= 0 && lane < 4) {
        const hitNote = this.handleLaneDown(lane);
        this.activeTouches.set(e.pointerId, {
          lane,
          startX: x,
          noteRef: hitNote
        });
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isRunning || this.isPaused) return;
      const touchData = this.activeTouches.get(e.pointerId);
      if (!touchData) return;

      const rect = this.canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const deltaX = currentX - touchData.startX;

      if (Math.abs(deltaX) >= 24) {
        const dir = deltaX > 0 ? 1 : -1;
        this.handleSlideGesture(touchData.lane, dir);
        touchData.startX = currentX;
      }
    });

    const releasePointer = (e) => {
      const touchData = this.activeTouches.get(e.pointerId);
      if (touchData) {
        this.handleLaneRelease(touchData.lane);
        this.activeTouches.delete(e.pointerId);
      }
    };
    this.canvas.addEventListener('pointerup', releasePointer);
    this.canvas.addEventListener('pointercancel', releasePointer);

    window.addEventListener('keydown', (e) => {
      if (!this.isRunning || this.isPaused || e.repeat) return;
      const keyMap = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
      if (keyMap[e.code] !== undefined) {
        const lane = keyMap[e.code];
        this.activeKeys.add(lane);
        this.handleLaneDown(lane);
      } else if (e.code === 'ArrowLeft') {
        this.handleSlideGesture(-1, -1);
      } else if (e.code === 'ArrowRight') {
        this.handleSlideGesture(-1, 1);
      }
    });

    window.addEventListener('keyup', (e) => {
      const keyMap = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
      if (keyMap[e.code] !== undefined) {
        const lane = keyMap[e.code];
        this.activeKeys.delete(lane);
        this.handleLaneRelease(lane);
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
    serverAudioManager.stopMenuTheme();
    serverAudioManager.stopResultMusic();
    previewManager.stop();
    this.stop();
    this.resizeCanvas();

    this.notes = [];
    this.particles = [];
    this.shockwaves = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.padPressScale = [1, 1, 1, 1];
    this.activeTouches.clear();
    this.activeKeys.clear();
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
    this.lastBassEnergy = 0;
    this.beatPulse = 0;

    this.updateScoreHUD();
    this.updateLifeUI();

    this.draw();
    await this.runCountdown();

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // Baik Lagu Bawaan Server maupun Lagu Lokal kini diputar melalui Real-Time Beat Analyser!
    const audioSource = appState.selectedSource === 'local'
      ? appState.localAudioBlob
      : appState.selectedSongSrc;

    const loaded = await this.setupAudioStream(audioSource);
    if (!loaded) {
      alert(`File lagu "${appState.selectedSongSrc}" belum ditemukan di folder server/proyek Anda.\nPastikan Anda sudah meletakkan file .mp3 tersebut sesuai path.`);
      document.getElementById('gameScreen').classList.remove('active');
      document.getElementById('menuScreen').classList.add('active');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  async setupAudioStream(source) {
    try {
      if (source instanceof Blob) {
        this.localObjectUrl = URL.createObjectURL(source);
        this.audioEl = new Audio(this.localObjectUrl);
      } else {
        this.audioEl = new Audio(source);
      }
      this.audioEl.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        this.audioEl.addEventListener('canplaythrough', resolve, { once: true });
        this.audioEl.addEventListener('error', reject, { once: true });
        this.audioEl.load();
      });

      const trackNode = this.audioCtx.createMediaElementSource(this.audioEl);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256; // Resolusi frekuensi lebih tajam untuk deteksi beat
      this.analyser.smoothingTimeConstant = 0.55;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      trackNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.audioEl.addEventListener('ended', () => this.finishGame(false));
      await this.audioEl.play();
      this.songDuration = this.audioEl.duration || 120;
      return true;
    } catch (err) {
      console.warn('Gagal memuat stream lagu:', err);
      return false;
    }
  }

  pause() {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.activeTouches.clear();
    this.activeKeys.clear();
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
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
    }

    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  // Analisis Beat Real-Time: Menggerakkan Kedipan Garis Target & Munculnya Balok Nada
  processRealTimeBeat(now) {
    if (!this.analyser || !this.dataArray) return;
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];

    this.analyser.getByteFrequencyData(this.dataArray);

    // Fokus pada rentang Sub-Bass & Kick Drum (bin 1 sampai 8)
    let bassSum = 0;
    for (let i = 1; i <= 8; i++) {
      bassSum += this.dataArray[i];
    }
    const bassAvg = bassSum / 8;

    // Update visualizer latar belakang
    for (let i = 0; i < this.visualizerBars.length; i++) {
      this.visualizerBars[i] = (this.dataArray[i * 2] || 0) * 0.65;
    }

    // Deteksi Lonjakan Beat (Onset Detection) untuk Kedipan Garis Target
    const energyDelta = bassAvg - this.lastBassEnergy;
    if (bassAvg > 125 && energyDelta > 9) {
      // Intensitas kedipan garis mengikuti kekuatan hentakan beat musik secara presisi
      this.beatPulse = Math.min(1.0, (bassAvg / 245) + (energyDelta / 60));
    }

    // Spawn balok nada jika melewati ambang batas level & cooldown
    if (now - this.lastSpawnTime >= levelCfg.cooldown && bassAvg > levelCfg.beatThreshold && energyDelta > 7) {
      const lane1 = Math.floor(Math.random() * 4);
      const roll = Math.random();

      if (roll < levelCfg.holdChance) {
        const holdLength = 120 + Math.random() * 95;
        this.notes.push({
          type: 'hold',
          lane: lane1,
          y: -30,
          length: holdLength,
          holding: false,
          hit: false,
          tickAccum: 0
        });
        this.lastSpawnTime = now + (holdLength / levelCfg.speed) * 650;
      } else if (roll < levelCfg.holdChance + levelCfg.slideChance) {
        const startLane = Math.floor(Math.random() * 3);
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.notes.push({
          type: 'slide',
          lane: startLane,
          span: 2,
          y: -30,
          slideDir: dir,
          hit: false
        });
        this.lastSpawnTime = now;
      } else {
        this.notes.push({
          type: 'tap',
          lane: lane1,
          y: -30,
          hit: false
        });

        if (Math.random() < levelCfg.doubleChance) {
          const lane2 = (lane1 + 1 + Math.floor(Math.random() * 3)) % 4;
          this.notes.push({
            type: 'tap',
            lane: lane2,
            y: -30,
            hit: false
          });
        }
        this.lastSpawnTime = now;
      }
    }

    // Peluruhan energi pembanding agar mampu menangkap ketukan berikutnya dengan cepat
    this.lastBassEnergy = bassAvg * 0.90;
  }

  handleLaneDown(lane) {
    this.laneFlashes[lane] = 1.0;
    this.padPressScale[lane] = 0.88;

    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    let closestNote = null;
    let minDiff = Infinity;

    for (const note of this.notes) {
      if (note.hit || note.holding) continue;
      const isLaneCovered = note.type === 'slide'
        ? (lane === note.lane || lane === note.lane + 1)
        : (note.lane === lane);

      if (isLaneCovered) {
        const diff = Math.abs(note.y - targetY);
        if (diff < minDiff) {
          minDiff = diff;
          closestNote = note;
        }
      }
    }

    if (!closestNote || minDiff > 105) return null;

    if (closestNote.type === 'slide') {
      closestNote.touched = true;
      return closestNote;
    }

    if (closestNote.type === 'hold') {
      closestNote.holding = true;
      this.missStreak = 0;
      this.evaluateTimingHit(minDiff, lane, 'HOLD!');
      return closestNote;
    }

    closestNote.hit = true;
    this.missStreak = 0;
    this.evaluateTimingHit(minDiff, lane);
    return closestNote;
  }

  handleSlideGesture(startLane, dir) {
    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    for (const note of this.notes) {
      if (note.type === 'slide' && !note.hit) {
        const laneMatch = startLane === -1 || startLane === note.lane || startLane === note.lane + 1 || note.touched;
        const diff = Math.abs(note.y - targetY);

        if (laneMatch && diff <= 120 && note.slideDir === dir) {
          note.hit = true;
          this.missStreak = 0;
          this.laneFlashes[note.lane] = 1.0;
          this.laneFlashes[note.lane + 1] = 1.0;

          this.score += 130 + this.combo * 5;
          this.combo++;
          this.perfectStreak++;
          this.perfectCount++;
          this.life = Math.min(100, this.life + 3);

          const isMilestone = this.perfectStreak >= 25 && this.perfectStreak % 25 === 0;
          const label = isMilestone ? `PERFECT x${this.perfectStreak}` : 'SLIDE PERFECT!';
          this.showFeedback(label, isMilestone ? 'anim-perfect-milestone' : 'anim-perfect');
          serverAudioManager.playSfx('slide', this.audioCtx);

          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.comboPulse = 1.35;
          this.spawnHitEffects(note.lane);
          this.spawnHitEffects(note.lane + 1);
          this.updateScoreHUD();
          this.updateLifeUI();
          if (navigator.vibrate) navigator.vibrate(20);
          return;
        }
      }
    }
  }

  handleLaneRelease(lane) {
    for (const note of this.notes) {
      if (note.type === 'hold' && note.lane === lane && note.holding && !note.hit) {
        const tailY = note.y - note.length;
        note.holding = false;
        note.hit = true;
        if (tailY >= this.hitLineY - 65) {
          this.score += 80;
          this.showFeedback('HOLD CLEAR!', 'anim-good');
          serverAudioManager.playSfx('perfect', this.audioCtx);
          this.spawnHitEffects(lane);
          this.updateScoreHUD();
        }
      }
    }
  }

  evaluateTimingHit(minDiff, lane, customPerfectText = null) {
    if (minDiff <= 42) {
      this.score += 100 + this.combo * 5;
      this.combo++;
      this.perfectStreak++;
      this.perfectCount++;

      let heal = 2;
      if (this.combo % 10 === 0) heal += 5;
      this.life = Math.min(100, this.life + heal);

      const isMilestone = this.perfectStreak >= 25 && this.perfectStreak % 25 === 0;
      const label = customPerfectText
        ? customPerfectText
        : (this.perfectStreak > 1 ? `PERFECT x${this.perfectStreak}` : 'PERFECT!');

      this.showFeedback(label, isMilestone ? 'anim-perfect-milestone' : 'anim-perfect');
      serverAudioManager.playSfx('perfect', this.audioCtx);

      this.shakeIntensity = isMilestone ? 6.5 : 1.5;
      if (navigator.vibrate) navigator.vibrate(isMilestone ? 30 : 14);
    } else if (minDiff <= 76) {
      this.score += 50 + this.combo * 2;
      this.combo++;
      this.perfectStreak = 0;
      this.goodCount++;

      if (this.combo % 10 === 0) {
        this.life = Math.min(100, this.life + 3);
      }

      this.showFeedback('GOOD', 'anim-good');
      serverAudioManager.playSfx('tap', this.audioCtx);
    } else {
      this.score += 15;
      this.combo = 0;
      this.perfectStreak = 0;
      this.badCount++;

      this.showFeedback('BAD', 'anim-bad');
      serverAudioManager.playSfx('tap', this.audioCtx);
    }

    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboPulse = 1.35;
    this.spawnHitEffects(lane);
    this.updateScoreHUD();
    this.updateLifeUI();
  }

  showFeedback(text, animClass) {
    const el = document.getElementById('hitFeedback');
    el.textContent = text;
    el.className = 'hit-feedback';
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

    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: cx,
        y: this.hitLineY,
        vx: (Math.random() - 0.5) * 250,
        vy: (Math.random() - 0.85) * 250,
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
      textEl.style.color = '#ffffff';
    }
  }

  loop(timestamp) {
    if (!this.isRunning || this.isPaused) return;

    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    let elapsedSec = 0;
    if (this.audioEl && !isNaN(this.audioEl.duration)) {
      elapsedSec = this.audioEl.currentTime;
      this.songDuration = this.audioEl.duration;
    }

    const progressPct = Math.min(100, (elapsedSec / this.songDuration) * 100);
    document.getElementById('songProgressBar').style.width = `${progressPct}%`;

    if (elapsedSec >= this.songDuration) {
      this.finishGame(false);
      return;
    }

    // Jalankan deteksi beat real-time dari audio yang sedang berputar
    this.processRealTimeBeat(timestamp);

    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    for (const note of this.notes) {
      if (note.hit) continue;

      note.y += levelCfg.speed * dt;

      if (note.type === 'hold' && note.holding) {
        this.laneFlashes[note.lane] = 0.85;
        this.padPressScale[note.lane] = 0.9;
        note.tickAccum += dt;
        if (note.tickAccum >= 0.08) {
          note.tickAccum = 0;
          this.score += 15;
          this.updateScoreHUD();
          this.spawnHitEffects(note.lane);
        }

        if (note.y - note.length >= this.hitLineY) {
          note.holding = false;
          note.hit = true;
          this.score += 100;
          this.life = Math.min(100, this.life + 3);
          this.showFeedback('HOLD PERFECT!', 'anim-perfect');
          serverAudioManager.playSfx('perfect', this.audioCtx);
          this.updateScoreHUD();
          this.updateLifeUI();
        }
      } else {
        if (note.y > this.height + 24) {
          note.hit = true;
          this.combo = 0;
          this.perfectStreak = 0;
          this.missCount++;
          this.missStreak++;
          this.comboPulse = 1.25;
          this.shakeIntensity = 5.5;

          this.life = Math.max(0, this.life - levelCfg.missDamage);
          this.updateLifeUI();
          serverAudioManager.playSfx('miss', this.audioCtx);

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

    for (let i = 0; i < 4; i++) {
      this.laneFlashes[i] = Math.max(0, this.laneFlashes[i] - dt * 4.5);
      this.padPressScale[i] += (1 - this.padPressScale[i]) * Math.min(1, dt * 18);
    }

    for (let i = 0; i < this.visualizerBars.length; i++) {
      this.visualizerBars[i] = Math.max(0, this.visualizerBars[i] - dt * 140);
    }

    // Peluruhan kedipan garis target (turun cepat sehingga tiap beat berkedip tajam)
    this.beatPulse = Math.max(0, this.beatPulse - dt * 6.5);
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

    // 2. Angka Combo / Miss Streak
    if (this.combo > 1) {
      ctx.save();
      ctx.translate(this.width / 2, this.height * 0.33);
      ctx.scale(this.comboPulse, this.comboPulse);

      ctx.font = '900 84px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = `rgba(${levelRgb}, 0.55)`;
      ctx.lineWidth = 3;
      ctx.strokeText(`${this.combo}`, 0, 0);

      ctx.fillStyle = `rgba(${levelRgb}, 0.34)`;
      ctx.fillText(`${this.combo}`, 0, 0);

      ctx.font = '900 15px Outfit, sans-serif';
      ctx.fillStyle = `rgba(255, 255, 255, 0.45)`;
      ctx.fillText('COMBO', 0, 24);
      ctx.restore();
    } else if (this.missStreak > 1) {
      ctx.save();
      ctx.translate(this.width / 2, this.height * 0.33);
      ctx.scale(this.comboPulse, this.comboPulse);

      ctx.font = '900 72px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
      ctx.lineWidth = 3;
      ctx.strokeText(`${this.missStreak}x`, 0, 0);

      ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
      ctx.fillText(`${this.missStreak}x`, 0, 0);

      ctx.font = '900 14px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(244, 63, 94, 0.65)';
      ctx.fillText('MISS STREAK', 0, 22);
      ctx.restore();
    }

    // 3. Jalur & Sorotan Ketukan
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
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
        ctx.stroke();
      }
    }

    // 4. Tuts Bawah Menyatu (Jarak Tipis 2px)
    const keyLabels = ['D', 'F', 'J', 'K'];
    for (let i = 0; i < 4; i++) {
      const padW = laneW - 2;
      const padH = 56;
      const cx = i * laneW + laneW / 2;
      const cy = this.hitLineY + 14;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(this.padPressScale[i], this.padPressScale[i]);

      ctx.fillStyle = this.laneFlashes[i] > 0.15
        ? `rgba(${levelRgb}, 0.42)`
        : 'rgba(255, 255, 255, 0.06)';

      ctx.beginPath();
      ctx.roundRect(-padW / 2, -padH / 2, padW, padH, 10);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.font = 'bold 12px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(keyLabels[i], 0, 4);
      ctx.restore();
    }

    // 5. Garis Target Semi-Transparan Berkedip Sesuai Deteksi Beat Bass Real-Time
    const pulseAlpha = 0.2 + this.beatPulse * 0.72;
    const pulseWidth = 2 + this.beatPulse * 3.5;
    ctx.save();
    ctx.strokeStyle = `rgba(${levelRgb}, ${pulseAlpha})`;
    ctx.lineWidth = pulseWidth;
    if (this.beatPulse > 0.15) {
      ctx.shadowColor = levelColor;
      ctx.shadowBlur = 16 * this.beatPulse;
    }
    ctx.beginPath();
    ctx.moveTo(0, this.hitLineY);
    ctx.lineTo(this.width, this.hitLineY);
    ctx.stroke();
    ctx.restore();

    // 6. Gambar Balok Nada (Tap, Hold Panjang, dan Slide 2 Tuts)
    for (const note of this.notes) {
      if (note.type === 'slide') {
        const x = note.lane * laneW + 4;
        const w = laneW * 2 - 8;
        const h = 34;
        const slideColor = '#facc15';

        const trailGrad = ctx.createLinearGradient(0, note.y - 65, 0, note.y);
        trailGrad.addColorStop(0, 'rgba(250, 204, 21, 0)');
        trailGrad.addColorStop(1, 'rgba(250, 204, 21, 0.22)');
        ctx.fillStyle = trailGrad;
        ctx.fillRect(x + 4, note.y - 65, w - 8, 65);

        ctx.fillStyle = slideColor;
        ctx.shadowColor = slideColor;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.roundRect(x, note.y - h / 2, w, h, 12);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#070913';
        ctx.font = '900 15px Outfit, sans-serif';
        ctx.textAlign = 'center';
        const arrowLabel = note.slideDir === 1 ? 'GESER  ▶ ▶ ▶' : '◀ ◀ ◀  GESER';
        ctx.fillText(arrowLabel, x + w / 2, note.y + 5);
        continue;
      }

      const x = note.lane * laneW + 5;
      const w = laneW - 10;
      const h = 30;

      if (note.type === 'hold') {
        const headY = note.holding ? this.hitLineY : note.y;
        const tailY = note.y - note.length;
        const bodyH = Math.max(0, headY - tailY);

        ctx.fillStyle = `rgba(${levelRgb}, 0.35)`;
        ctx.beginPath();
        ctx.roundRect(x + 6, tailY, w - 12, bodyH, 10);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x + w / 2 - 2, tailY + 6, 4, Math.max(0, bodyH - 12));

        ctx.fillStyle = levelColor;
        ctx.shadowColor = levelColor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.roundRect(x, headY - h / 2, w, h, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#070913';
        ctx.font = '900 10px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HOLD', x + w / 2, headY + 3.5);
      } else {
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
    }

    // 7. Shockwaves & Partikel
    for (const sw of this.shockwaves) {
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${levelRgb}, ${Math.max(0, sw.alpha)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

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

  // Perhitungan Grade SSS sampai F + Animasi & SFX Penghitung Skor
  calculateGrade(accuracy, isGameOver) {
    if (isGameOver || accuracy < 45) return { grade: 'F', cls: 'grade-f', title: 'Gagal Fokus!' };
    if (accuracy >= 99 && this.missCount === 0 && this.badCount === 0) {
      return { grade: 'SSS', cls: 'grade-sss', title: 'DEWA RITME! SEMPURNA!' };
    }
    if (accuracy >= 96 && this.missCount === 0) {
      return { grade: 'SS', cls: 'grade-ss', title: 'NYARIS SEMPURNA!' };
    }
    if (accuracy >= 90) return { grade: 'S', cls: 'grade-s', title: 'Luar Biasa! Stres Hilang!' };
    if (accuracy >= 80) return { grade: 'A', cls: 'grade-a', title: 'Mantap! Ritmemu Stabil!' };
    if (accuracy >= 70) return { grade: 'B', cls: 'grade-b', title: 'Bagus! Tetap Santuy!' };
    if (accuracy >= 60) return { grade: 'C', cls: 'grade-c', title: 'Lumayan Buat Lemesin Jari!' };
    return { grade: 'D', cls: 'grade-d', title: 'Nyaris Kalah, Coba Lagi!' };
  }

  animateScoreCounter(targetScore, highScore, gradeInfo) {
    const scoreEl = document.getElementById('finalScore');
    const highEl = document.getElementById('finalHighScore');
    const rankEl = document.getElementById('resultRank');

    rankEl.textContent = '?';
    rankEl.className = 'result-rank';

    const durationMs = 1150;
    const startTime = performance.now();
    let lastTickSound = 0;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      // Ease-out cubic agar melambat dramatis menjelang angka akhir
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.floor(eased * targetScore);

      scoreEl.textContent = currentVal.toLocaleString('id-ID');
      highEl.textContent = Math.max(currentVal, highScore).toLocaleString('id-ID');

      // Putar SFX tick penghitung skor setiap 65ms selama angka berputar
      if (targetScore > 0 && now - lastTickSound >= 65 && progress < 1) {
        lastTickSound = now;
        serverAudioManager.playSfx('scoreTick');
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        scoreEl.textContent = targetScore.toLocaleString('id-ID');
        highEl.textContent = highScore.toLocaleString('id-ID');

        // Stempel Grade SSS - F muncul setelah skor selesai dihitung
        rankEl.textContent = gradeInfo.grade;
        rankEl.className = `result-rank ${gradeInfo.cls} grade-stamp`;
        serverAudioManager.playSfx('perfect');
      }
    };

    requestAnimationFrame(step);
  }

  finishGame(isGameOver = false) {
    this.stop();

    // Putar musik Game Over atau Stage Clear dari server
    serverAudioManager.playResultMusic(isGameOver);

    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    let highScore = this.score;
    if (appState.selectedSource === 'local') {
      highScore = saveLocalSongRecord(appState.selectedSongTitle, appState.selectedLevel, this.score);
    } else {
      const key = `builtin_hs_${appState.selectedSongId}_${appState.selectedLevel}`;
      const prev = Number(localStorage.getItem(APP_CONFIG.storageKeyPrefix + key) || 0);
      highScore = Math.max(prev, this.score);
      localStorage.setItem(APP_CONFIG.storageKeyPrefix + key, String(highScore));
    }

    const totalNotes = this.perfectCount + this.goodCount + this.badCount + this.missCount;
    const accuracy = totalNotes > 0
      ? ((this.perfectCount + this.goodCount * 0.7 + this.badCount * 0.3) / totalNotes) * 100
      : 100;

    const gradeInfo = this.calculateGrade(accuracy, isGameOver);

    document.getElementById('resultTitle').textContent = isGameOver
      ? 'Game Over!'
      : gradeInfo.title;
    document.getElementById('resultSubtitle').textContent = isGameOver
      ? 'Cobaan terlalu deras, tarik napas dulu lalu coba lagi!'
      : `Akurasi Ketukan: ${accuracy.toFixed(1)}%`;

    document.getElementById('finalHighScoreLabel').textContent = `High Score (${levelCfg.short})`;
    document.getElementById('finalMaxCombo').textContent = `${this.maxCombo}x`;
    document.getElementById('finalPerfect').textContent = this.perfectCount;
    document.getElementById('finalGood').textContent = this.goodCount;
    document.getElementById('finalBad').textContent = this.badCount;
    document.getElementById('finalMiss').textContent = this.missCount;

    document.getElementById('resultModal').classList.remove('hidden');
    this.animateScoreCounter(this.score, highScore, gradeInfo);
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.activeTouches.clear();
    this.activeKeys.clear();
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
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
  serverAudioManager.init();
  rhythmEngine = new RhythmEngine();

  // Putar Theme Song dari server saat aplikasi pertama kali disentuh
  const unlockThemeAudio = () => {
    serverAudioManager.startMenuTheme();
    window.removeEventListener('pointerdown', unlockThemeAudio);
    window.removeEventListener('keydown', unlockThemeAudio);
  };
  window.addEventListener('pointerdown', unlockThemeAudio);
  window.addEventListener('keydown', unlockThemeAudio);

  // Tombol Mute/Unmute Theme Song Menu
  const bgmBtn = document.getElementById('bgmToggleBtn');
  bgmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.bgmEnabled = !appState.bgmEnabled;
    if (appState.bgmEnabled) {
      bgmBtn.textContent = '🎵 ON';
      bgmBtn.classList.remove('muted');
      serverAudioManager.startMenuTheme();
    } else {
      bgmBtn.textContent = '🔇 OFF';
      bgmBtn.classList.add('muted');
      serverAudioManager.stopMenuTheme();
    }
  });

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

  // Pilih Lagu Bawaan Server + Preview
  document.querySelectorAll('.song-card-3d').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.song-card-3d').forEach((el) => {
        el.classList.remove('selected');
        el.querySelector('.status-pill').textContent = 'PILIH';
      });
      item.classList.add('selected');
      item.querySelector('.status-pill').textContent = 'AKTIF';

      appState.selectedSource = 'builtin';
      appState.selectedSongId = item.dataset.song;
      appState.selectedSongSrc = item.dataset.src;
      appState.selectedSongTitle = item.querySelector('strong').textContent;

      previewManager.playPreviewFromSrcOrBlob(appState.selectedSongSrc);
    });
  });

  // Upload Lagu Lokal + Validasi Durasi
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
      alert(`Durasi lagu terlalu panjang (${mins} menit). Maksimal durasi lagu adalah 10 menit.`);
      fileInput.value = '';
      return;
    }

    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    appState.selectedSource = 'local';
    appState.localAudioBlob = file;
    appState.selectedSongTitle = cleanTitle;

    document.getElementById('uploadedFileName').textContent = `✅ ${cleanTitle}`;
    await saveSongBlobToDB(cleanTitle, file);
    saveLocalSongRecord(cleanTitle, appState.selectedLevel, 0);
    previewManager.playPreviewFromSrcOrBlob(file);
  });

  // Pilih 4 Level Kesulitan
  document.querySelectorAll('.level-btn-3d').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.level-btn-3d').forEach((c) => c.classList.remove('selected'));
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
    serverAudioManager.startMenuTheme();
  });

  // Tombol di Modal Hasil Akhir
  document.getElementById('playAgainBtn').addEventListener('click', async () => {
    serverAudioManager.stopResultMusic();
    document.getElementById('resultModal').classList.add('hidden');
    await rhythmEngine.start();
  });

  document.getElementById('resultMenuBtn').addEventListener('click', () => {
    serverAudioManager.stopResultMusic();
    document.getElementById('resultModal').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('active');
    document.getElementById('menuScreen').classList.add('active');
    serverAudioManager.startMenuTheme();
  });

  // Modal Pengaturan
  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('sfxToggleCheckbox').addEventListener('change', (e) => {
    appState.sfxEnabled = e.target.checked;
    localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'sfxEnabled', String(appState.sfxEnabled));
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
