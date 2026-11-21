// Konfigurasi Utama Aplikasi
const APP_CONFIG = {
  trialDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 Hari (72 Jam)
  storageKeyPrefix: 'zenbeat_v1_',
  levels: {
    easy: {
      name: 'Mode Santuy',
      color: '#38bdf8',
      speed: 270, // piksel per detik
      cooldown: 650,
      doubleChance: 0,
      beatThreshold: 175
    },
    normal: {
      name: 'Mode Biasa Aja',
      color: '#34d399',
      speed: 380,
      cooldown: 430,
      doubleChance: 0.06,
      beatThreshold: 160
    },
    hard: {
      name: 'Mode Sistem Kebut Semalam (SKS)',
      color: '#fb923c',
      speed: 510,
      cooldown: 240,
      doubleChance: 0.16,
      beatThreshold: 145
    },
    extreme: {
      name: 'Mode WNI',
      color: '#f43f5e',
      speed: 650,
      cooldown: 145,
      doubleChance: 0.35,
      beatThreshold: 132
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
  localAudioFile: null,
  selectedLevel: 'easy',
  audioOffset: 0
};

// --- 1. SISTEM PENYIMPANAN GANDA (localStorage + IndexedDB) ---
function openLicenseDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZenBeatLicenseDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getPersistedValue(key) {
  const localVal = localStorage.getItem(APP_CONFIG.storageKeyPrefix + key);
  try {
    const db = await openLicenseDB();
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
    const db = await openLicenseDB();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
  } catch (err) {
    console.warn('IndexedDB fallback:', err);
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

// --- 2. MESIN GAME & AUTO-BEAT AUDIO ENGINE (TAHAP 2) ---
class RhythmEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.animFrameId = null;

    // Audio
    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.audioEl = null;
    this.localObjectUrl = null;
    this.synthInterval = null;

    // Gameplay State
    this.notes = [];
    this.particles = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.lastSpawnTime = 0;
    this.lastFrameTime = 0;
    this.lastEnergy = 0;
    this.songStartTime = 0;
    this.songDuration = 45; // default 45 detik untuk lagu bawaan

    // Skor
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
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
    this.hitLineY = this.height - 78;
  }

  bindInputs() {
    // Sentuhan Layar HP (Multi-touch support untuk Mode WNI)
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isRunning) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const lane = Math.floor(x / (this.width / 4));
      if (lane >= 0 && lane < 4) {
        this.handleLaneHit(lane);
      }
    });

    // Keyboard Laptop (D, F, J, K)
    window.addEventListener('keydown', (e) => {
      if (!this.isRunning || e.repeat) return;
      const keyMap = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
      if (keyMap[e.code] !== undefined) {
        this.handleLaneHit(keyMap[e.code]);
      }
    });
  }

  async start() {
    this.stop();
    this.resizeCanvas();

    // Reset Skor & State
    this.notes = [];
    this.particles = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.missCount = 0;
    this.lastSpawnTime = 0;
    this.lastEnergy = 0;
    this.updateScoreHUD();

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    if (appState.selectedSource === 'local' && appState.localAudioFile) {
      await this.setupLocalAudio(appState.localAudioFile);
    } else {
      this.setupBuiltinSynth(appState.selectedSongId, appState.selectedSongBpm);
    }

    this.isRunning = true;
    this.songStartTime = performance.now();
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  async setupLocalAudio(file) {
    this.localObjectUrl = URL.createObjectURL(file);
    this.audioEl = new Audio(this.localObjectUrl);
    this.audioEl.crossOrigin = 'anonymous';

    const source = this.audioCtx.createMediaElementSource(this.audioEl);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.audioEl.addEventListener('ended', () => this.finishGame());
    await this.audioEl.play();
    this.songDuration = this.audioEl.duration || 120;
  }

  // Synthesizer Instrumental Bawaan (100% Offline, 0 KB, Bebas Hak Cipta)
  setupBuiltinSynth(songId, bpm) {
    this.songDuration = 45; // 45 detik per sesi relaksasi
    const beatMs = (60 / bpm) * 1000;
    const chordsMap = {
      'lofi-chill': [
        [261.63, 329.63, 392.00, 493.88], // Cmaj7
        [220.00, 261.63, 329.63, 392.00], // Am7
        [174.61, 220.00, 261.63, 349.23], // Fmaj7
        [196.00, 246.94, 293.66, 392.00]  // G6
      ],
      'night-drive': [
        [146.83, 220.00, 293.66, 349.23], // Dm
        [116.54, 174.61, 233.08, 293.66], // Bb
        [130.81, 196.00, 261.63, 329.63], // C
        [110.00, 164.81, 220.00, 261.63]  // Am
      ],
      'coffee-rush': [
        [164.81, 246.94, 329.63, 392.00], // Em
        [130.81, 196.00, 261.63, 329.63], // C
        [196.00, 246.94, 293.66, 392.00], // G
        [146.83, 220.00, 293.66, 369.99]  // D
      ]
    };

    const chords = chordsMap[songId] || chordsMap['lofi-chill'];
    let step = 0;

    const playStep = () => {
      if (!this.isRunning) return;
      const now = this.audioCtx.currentTime;
      const chord = chords[Math.floor(step / 4) % chords.length];

      // Mainkan pad chord tiap 4 ketukan
      if (step % 4 === 0) {
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

      // Mainkan bass kick tiap ketukan
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

      // Melodi petikan lembut
      const noteFreq = chord[step % chord.length] * 2;
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

      // Picu kemunculan balok sesuai ketukan lagu bawaan
      this.trySpawnBeatNote(performance.now(), true);
      step++;
    };

    playStep();
    this.synthInterval = setInterval(playStep, beatMs);
  }

  playTapClick(isPerfect) {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isPerfect ? 880 : 620, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.045);

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  trySpawnBeatNote(now, forceBeat = false) {
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    if (now - this.lastSpawnTime < levelCfg.cooldown) return;

    let isBeat = forceBeat;

    // Jika lagu MP3 lokal, analisis dentuman bass secara real-time
    if (!forceBeat && this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
      // Rata-rata frekuensi rendah (Bass: index 1 - 12)
      let bassSum = 0;
      for (let i = 1; i <= 12; i++) {
        bassSum += this.dataArray[i];
      }
      const bassAvg = bassSum / 12;

      if (bassAvg > levelCfg.beatThreshold && bassAvg > this.lastEnergy + 8) {
        isBeat = true;
      }
      this.lastEnergy = bassAvg * 0.92;
    }

    if (isBeat) {
      this.lastSpawnTime = now;
      const lane1 = Math.floor(Math.random() * 4);
      this.notes.push({ lane: lane1, y: -30, hit: false });

      // Peluang Double Tap (Terutama di Mode SKS & Mode WNI)
      if (Math.random() < levelCfg.doubleChance) {
        let lane2 = (lane1 + 1 + Math.floor(Math.random() * 3)) % 4;
        this.notes.push({ lane: lane2, y: -30, hit: false });
      }
    }
  }

  handleLaneHit(lane) {
    this.laneFlashes[lane] = 1.0;
    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    // Cari balok terdekat di jalur yang ditekan
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

    if (closestNote && minDiff <= 85) {
      closestNote.hit = true;
      if (minDiff <= 38) {
        this.score += 100 + this.combo * 5;
        this.combo++;
        this.perfectCount++;
        this.showFeedback('PERFECT!', '#38bdf8');
        this.playTapClick(true);
      } else {
        this.score += 50 + this.combo * 2;
        this.combo++;
        this.goodCount++;
        this.showFeedback('GOOD', '#34d399');
        this.playTapClick(false);
      }
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.spawnParticles(lane);
      this.updateScoreHUD();
    }
  }

  showFeedback(text, color) {
    const el = document.getElementById('hitFeedback');
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');

    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 280);
  }

  spawnParticles(lane) {
    const laneW = this.width / 4;
    const cx = lane * laneW + laneW / 2;
    const levelColor = APP_CONFIG.levels[appState.selectedLevel].color;

    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: cx,
        y: this.hitLineY,
        vx: (Math.random() - 0.5) * 220,
        vy: (Math.random() - 0.8) * 220,
        alpha: 1,
        color: levelColor
      });
    }
  }

  updateScoreHUD() {
    document.getElementById('scoreDisplay').textContent = this.score;
    document.getElementById('comboDisplay').textContent = this.combo;
  }

  loop(timestamp) {
    if (!this.isRunning) return;

    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    // Update Progress Lagu
    let elapsedSec = (timestamp - this.songStartTime) / 1000;
    if (this.audioEl && !isNaN(this.audioEl.duration)) {
      elapsedSec = this.audioEl.currentTime;
      this.songDuration = this.audioEl.duration;
    }

    const progressPct = Math.min(100, (elapsedSec / this.songDuration) * 100);
    document.getElementById('songProgressBar').style.width = `${progressPct}%`;

    if (elapsedSec >= this.songDuration) {
      this.finishGame();
      return;
    }

    // Deteksi Ketukan Lagu Lokal
    if (appState.selectedSource === 'local') {
      this.trySpawnBeatNote(timestamp, false);
    }

    // Update Posisi Balok
    const speed = APP_CONFIG.levels[appState.selectedLevel].speed;
    for (const note of this.notes) {
      if (!note.hit) {
        note.y += speed * dt;
        if (note.y > this.height + 20) {
          note.hit = true;
          this.combo = 0;
          this.missCount++;
          this.showFeedback('MISS', '#f43f5e');
          this.updateScoreHUD();
        }
      }
    }
    this.notes = this.notes.filter((n) => !n.hit);

    // Update Partikel & Kilauan Jalur
    for (let i = 0; i < 4; i++) {
      if (this.laneFlashes[i] > 0) {
        this.laneFlashes[i] = Math.max(0, this.laneFlashes[i] - dt * 4.5);
      }
    }

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= dt * 2.5;
    }
    this.particles = this.particles.filter((p) => p.alpha > 0);

    this.draw();
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  draw() {
    const ctx = this.ctx;
    const laneW = this.width / 4;
    const levelColor = APP_CONFIG.levels[appState.selectedLevel].color;

    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Gambar 4 Jalur & Efek Kilauan Ketukan
    for (let i = 0; i < 4; i++) {
      const x = i * laneW;
      if (this.laneFlashes[i] > 0) {
        const grad = ctx.createLinearGradient(0, this.hitLineY - 140, 0, this.height);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
        grad.addColorStop(1, `rgba(56, 189, 248, ${this.laneFlashes[i] * 0.28})`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, laneW, this.height);
      }

      // Garis pembatas jalur
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.height);
        ctx.stroke();
      }
    }

    // 2. Garis Target Ketukan (Hit Zone)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(0, this.hitLineY - 22, this.width, 44);

    ctx.strokeStyle = levelColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, this.hitLineY);
    ctx.lineTo(this.width, this.hitLineY);
    ctx.stroke();

    // Tombol Lingkaran Target di Tiap Jalur
    const keyLabels = ['D', 'F', 'J', 'K'];
    for (let i = 0; i < 4; i++) {
      const cx = i * laneW + laneW / 2;
      ctx.beginPath();
      ctx.arc(cx, this.hitLineY, 22, 0, Math.PI * 2);
      ctx.strokeStyle = this.laneFlashes[i] > 0.2 ? '#ffffff' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(keyLabels[i], cx, this.hitLineY + 4);
    }

    // 3. Gambar Balok Nada yang Jatuh
    for (const note of this.notes) {
      const x = note.lane * laneW + 10;
      const w = laneW - 20;
      const h = 26;

      ctx.fillStyle = levelColor;
      ctx.shadowColor = levelColor;
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.roundRect(x, note.y - h / 2, w, h, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // 4. Gambar Partikel Ledakan Ketukan
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  finishGame() {
    this.stop();

    const totalNotes = this.perfectCount + this.goodCount + this.missCount;
    const accuracy = totalNotes > 0 ? ((this.perfectCount + this.goodCount * 0.7) / totalNotes) * 100 : 100;

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

    document.getElementById('resultRank').textContent = rank;
    document.getElementById('resultTitle').textContent = title;
    document.getElementById('finalScore').textContent = this.score;
    document.getElementById('finalMaxCombo').textContent = `${this.maxCombo}x`;
    document.getElementById('finalPerfect').textContent = this.perfectCount;
    document.getElementById('finalGood').textContent = this.goodCount;
    document.getElementById('finalMiss').textContent = this.missCount;

    document.getElementById('resultModal').classList.remove('hidden');
  }

  stop() {
    this.isRunning = false;
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

// --- 3. INTERAKSI UI MENU UTAMA ---
let rhythmEngine = null;

function setupUIEvents() {
  rhythmEngine = new RhythmEngine();

  // Tab Lagu Bawaan vs Lokal
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      appState.selectedSource = target;
      document.getElementById(`${target}Tab`).classList.add('active');
    });
  });

  // Pilih Lagu Bawaan
  document.querySelectorAll('.song-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.song-item').forEach((el) => {
        el.classList.remove('selected');
        el.querySelector('.badge-check').textContent = 'Pilih';
      });
      item.classList.add('selected');
      item.querySelector('.badge-check').textContent = 'Dipilih';

      appState.selectedSongId = item.dataset.song;
      appState.selectedSongBpm = Number(item.dataset.bpm) || 100;
      appState.selectedSongTitle = item.querySelector('strong').textContent;
    });
  });

  // Upload Lagu Lokal (MP3/WAV)
  const fileInput = document.getElementById('audioFileInput');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      appState.localAudioFile = file;
      appState.selectedSongTitle = file.name.replace(/\.[^/.]+$/, '');
      document.getElementById('uploadedFileName').textContent = `✅ ${file.name}`;
    }
  });

  // Pilih 4 Level Kesulitan
  document.querySelectorAll('.level-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.level-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.selectedLevel = card.dataset.level;
    });
  });

  // Tombol Mulai Main
  document.getElementById('startGameBtn').addEventListener('click', async () => {
    if (!updateTrialUI()) return;

    if (appState.selectedSource === 'local' && !appState.localAudioFile) {
      alert('Pilih file lagu MP3/WAV dari perangkatmu terlebih dahulu ya!');
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

  // Tombol Berhenti & Kembali ke Menu
  document.getElementById('backToMenuBtn').addEventListener('click', () => {
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

  // Placeholder Tombol Aktivasi (Dihubungkan ke Cloudflare Worker di Tahap 3 & 4)
  document.getElementById('activateBtn').addEventListener('click', () => {
    const code = document.getElementById('licenseInput').value.trim();
    if (!code) {
      alert('Masukkan kode aktivasi dari Lynk.id terlebih dahulu.');
      return;
    }
    alert(`Kode "${code}" siap divalidasi ke Cloudflare Worker pada Tahap 3 & 4!`);
  });
}

// --- 4. PWA SERVICE WORKER & INSTALL PROMPT ---
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
