// Konfigurasi Utama Aplikasi & Lokasi File Audio Server
const APP_CONFIG = {
  trialDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 Hari (72 Jam)
  minSongDurationSec: 30,                   // Minimal 30 detik
  maxSongDurationSec: 10 * 60,              // Maksimal 10 menit (600 detik)
  storageKeyPrefix: 'zenbeat_v1_',
  serverAudio: {
    menuTheme: 'assets/audio/theme-menu.mp3',
    songsManifest: 'assets/audio/songs/songs.json',
    sfx: {
      tap: 'assets/audio/sfx/tap.mp3',
      perfect: 'assets/audio/sfx/perfect.mp3',
      slide: 'assets/audio/sfx/slide.mp3',
      miss: 'assets/audio/sfx/miss.mp3',
      scoreTick: 'assets/audio/sfx/score-tick.mp3',
      buttonClick: 'assets/audio/sfx/click.mp3' // SFX saat klik tombol menu/UI
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
      holdChance: 0.16,
      slideChance: 0, // Slide hanya di Hard & Extreme
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
      holdChance: 0.20,
      slideChance: 0, // Slide hanya di Hard & Extreme
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
      slideChance: 0.24,
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
  selectedSongId: '',
  selectedSongSrc: '',
  selectedSongTitle: '',
  serverSongBlob: null,
  localAudioBlob: null,
  selectedLevel: 'easy',
  audioOffset: 0,
  sfxEnabled: true,
  bgmEnabled: true,
  isDownloadingSong: false
};

// --- 1. INDEXEDDB (LISENSI, LAGU LOKAL & CACHE UNDUHAN LAGU SERVER) ---
function openAppDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZenBeatAppDB', 5);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'title' });
      }
      if (!db.objectStoreNames.contains('server_songs')) {
        db.createObjectStore('server_songs', { keyPath: 'src' });
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

async function saveServerSongBlob(src, blob) {
  try {
    const db = await openAppDB();
    const tx = db.transaction('server_songs', 'readwrite');
    tx.objectStore('server_songs').put({ src, blob, savedAt: Date.now() });
  } catch (err) {
    console.warn('Gagal cache lagu server:', err);
  }
}

async function getServerSongBlob(src) {
  try {
    const db = await openAppDB();
    return new Promise((resolve) => {
      const tx = db.transaction('server_songs', 'readonly');
      const req = tx.objectStore('server_songs').get(src);
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

// --- 2. SERVER AUDIO MANAGER (SFX KETUKAN & SFX KLIK TOMBOL MENU) ---
const serverAudioManager = {
  menuAudio: null,
  resultAudio: null,
  sfxBuffers: {},
  sharedCtx: null,
  synthTimer: null,
  isPlayingSynth: false,

  ensureCtx() {
    if (!this.sharedCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.sharedCtx = new AudioContextClass();
    }
    if (this.sharedCtx.state === 'suspended') {
      this.sharedCtx.resume().catch(() => {});
    }
    return this.sharedCtx;
  },

  async init() {
    const ctx = this.ensureCtx();
    const entries = Object.entries(APP_CONFIG.serverAudio.sfx);

    await Promise.all(entries.map(async ([key, src]) => {
      try {
        const res = await fetch(`${src}?v=${Date.now()}`);
        if (!res.ok) return;
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        this.sfxBuffers[key] = audioBuf;
      } catch (err) {
        console.warn(`SFX file "${src}" belum terbaca, memakai suara cadangan:`, err.message);
      }
    }));
  },

  startFallbackSynthMenu() {
    if (this.isPlayingSynth || !appState.bgmEnabled) return;
    if (document.getElementById('gameScreen').classList.contains('active')) return;

    const ctx = this.ensureCtx();
    this.isPlayingSynth = true;
    const chords = [
      [174.61, 220.00, 261.63, 329.63],
      [164.81, 196.00, 246.94, 293.66],
      [146.83, 174.61, 220.00, 261.63],
      [130.81, 164.81, 196.00, 246.94]
    ];
    let step = 0;

    const playChord = () => {
      if (!this.isPlayingSynth || !appState.bgmEnabled) return;
      if (document.getElementById('gameScreen').classList.contains('active')) {
        this.stopFallbackSynthMenu();
        return;
      }

      const now = ctx.currentTime;
      const notes = chords[step % chords.length];
      step++;

      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);

        gain.gain.setValueAtTime(0.0001, now + idx * 0.06);
        gain.gain.linearRampToValueAtTime(0.028, now + idx * 0.06 + 0.25);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + 2.4);
      });
    };

    playChord();
    this.synthTimer = setInterval(playChord, 2500);
  },

  stopFallbackSynthMenu() {
    this.isPlayingSynth = false;
    if (this.synthTimer) {
      clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
  },

  startMenuTheme() {
    if (!appState.bgmEnabled) return;
    if (document.getElementById('gameScreen').classList.contains('active')) return;
    this.stopResultMusic();

    if (!this.menuAudio) {
      this.menuAudio = new Audio(APP_CONFIG.serverAudio.menuTheme);
      this.menuAudio.loop = true;
      this.menuAudio.volume = 0.55;
      this.menuAudio.addEventListener('error', () => {
        this.menuAudio = null;
        this.startFallbackSynthMenu();
      }, { once: true });
    }

    this.menuAudio.play()
      .then(() => this.stopFallbackSynthMenu())
      .catch(() => this.startFallbackSynthMenu());
  },

  stopMenuTheme() {
    this.stopFallbackSynthMenu();
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

  playSfx(type) {
    if (!appState.sfxEnabled) return;
    const ctx = this.ensureCtx();

    const buffer = this.sfxBuffers[type];
    if (buffer) {
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      source.buffer = buffer;
      gainNode.gain.value = type === 'scoreTick' ? 0.45 : (type === 'buttonClick' ? 0.75 : 0.9);
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
      return;
    }

    // Suara synth cadangan jika file mp3 di server belum tersedia
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type === 'miss' ? 'sawtooth' : (type === 'buttonClick' ? 'sine' : 'triangle');
    const freqMap = {
      perfect: 1046,
      slide: 1318,
      tap: 660,
      miss: 130,
      scoreTick: 880,
      buttonClick: 580
    };
    osc.frequency.setValueAtTime(freqMap[type] || 660, now);
    gain.gain.setValueAtTime(type === 'buttonClick' ? 0.05 : 0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'buttonClick' ? 0.055 : 0.09));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }
};

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
      this.audioEl = new Audio(encodeURI(source));
    }

    this.audioEl.volume = 0.65;
    this.audioEl.addEventListener('loadedmetadata', () => {
      if (this.audioEl && this.audioEl.duration > 15) {
        this.audioEl.currentTime = Math.min(this.audioEl.duration * 0.2, 25);
      }
      this.audioEl.play().catch(() => {});
    });

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

// --- 3. TUTORIAL AWAL PERTAMA KALI BUKA ---
const TUTORIAL_STEPS = [
  {
    visual: '🎵',
    title: '1. Pilih Lagu Favoritmu',
    desc: 'Ketuk salah satu lagu bawaan server atau pilih file MP3/WAV dari perangkatmu untuk mulai bermain.'
  },
  {
    visual: '🔥',
    title: '2. Tentukan Tingkat Tantangan',
    desc: 'Setelah memilih lagu, pilih level dari Mode Santuy (Easy) hingga Mode WNI (Extreme), lalu tekan Mulai Main.'
  },
  {
    visual: '👆',
    title: '3. Tap, Hold & Geser Bebas',
    desc: 'Ketuk saat balok menyentuh garis bawah, tahan balok panjang (HOLD), dan geser ke arah mana saja untuk balok Slide.'
  },
  {
    visual: '❤️',
    title: '4. Jaga Nyawa & Raih Grade SSS',
    desc: 'Jangan biarkan bar hati habis! Kumpulkan kombo tinggi untuk meraih peringkat tertinggi hingga SSS.'
  }
];

let currentTutorialStep = 0;

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[currentTutorialStep];
  document.getElementById('tutorialStepBadge').textContent = `Langkah ${currentTutorialStep + 1} dari ${TUTORIAL_STEPS.length}`;
  document.getElementById('tutorialVisual').textContent = step.visual;
  document.getElementById('tutorialTitle').textContent = step.title;
  document.getElementById('tutorialDesc').textContent = step.desc;

  document.querySelectorAll('.t-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentTutorialStep);
  });

  const nextBtn = document.getElementById('nextTutorialBtn');
  nextBtn.textContent = currentTutorialStep === TUTORIAL_STEPS.length - 1 ? 'Selesai ✓' : 'Lanjut ▶';
}

function openTutorialModal() {
  currentTutorialStep = 0;
  renderTutorialStep();
  document.getElementById('tutorialModal').classList.remove('hidden');
}

function closeTutorialModal() {
  document.getElementById('tutorialModal').classList.add('hidden');
  localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'tutorial_seen', 'true');
}

// --- 4. PEMILIHAN LAGU, REVEAL LEVEL & HIGH SCORE ---
function revealLevelSection(songTitle) {
  const section = document.getElementById('levelActionSection');
  const caption = document.getElementById('selectedSongCaption');
  caption.textContent = `Lagu terpilih: ${songTitle}`;
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideLevelSection() {
  document.getElementById('levelActionSection').classList.add('hidden');
  document.querySelectorAll('.song-card-3d').forEach((el) => el.classList.remove('selected'));
  document.querySelectorAll('.history-item').forEach((el) => el.classList.remove('active-history'));
  appState.selectedSongId = '';
  appState.selectedSongSrc = '';
  appState.selectedSongTitle = '';
  appState.serverSongBlob = null;
  appState.localAudioBlob = null;
}

async function downloadServerSongWithProgress(src, onProgress) {
  const response = await fetch(encodeURI(src));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;

    if (total > 0) {
      const pct = Math.min(99, Math.round((loaded / total) * 100));
      onProgress(pct);
    } else {
      onProgress(50);
    }
  }

  const blob = new Blob(chunks, { type: 'audio/mpeg' });
  onProgress(100);
  await saveServerSongBlob(src, blob);
  return blob;
}

function getBuiltinHighScores(songId) {
  const levels = ['easy', 'normal', 'hard', 'extreme'];
  const result = {};
  levels.forEach((lk) => {
    const key = `builtin_hs_${songId}_${lk}`;
    result[lk] = Number(localStorage.getItem(APP_CONFIG.storageKeyPrefix + key) || 0);
  });
  return result;
}

function buildScoreGridHtml(scores) {
  const levelKeys = ['easy', 'normal', 'hard', 'extreme'];
  return levelKeys.map((lk) => {
    const cfg = APP_CONFIG.levels[lk];
    const val = scores[lk] || 0;
    return `
      <div class="hs-badge">
        <small style="color: ${cfg.color}">${cfg.short}</small>
        <span>${val > 0 ? val.toLocaleString('id-ID') : '-'}</span>
      </div>
    `;
  }).join('');
}

async function selectAndPrepareServerSong(song, cardEl, autoPlayPreview = true) {
  if (appState.isDownloadingSong) return;

  document.querySelectorAll('.song-card-3d').forEach((el) => {
    el.classList.remove('selected');
  });
  cardEl.classList.add('selected');

  appState.selectedSource = 'builtin';
  appState.selectedSongId = song.id;
  appState.selectedSongSrc = song.src;
  appState.selectedSongTitle = song.title;

  revealLevelSection(song.title);

  const pillEl = cardEl.querySelector('.status-pill');
  const progressWrap = cardEl.querySelector('.dl-progress-wrap');
  const fillEl = cardEl.querySelector('.dl-fill');
  const pctEl = cardEl.querySelector('.dl-pct');

  let cachedBlob = await getServerSongBlob(song.src);
  if (cachedBlob && cachedBlob.size > 1024) {
    appState.serverSongBlob = cachedBlob;
    pillEl.textContent = '✓ SIAP';
    pillEl.classList.add('ready');
    progressWrap.classList.add('hidden');
    if (autoPlayPreview) {
      previewManager.playPreviewFromSrcOrBlob(cachedBlob);
    }
    return;
  }

  appState.isDownloadingSong = true;
  appState.serverSongBlob = null;
  pillEl.textContent = 'MENGUNDUH...';
  progressWrap.classList.remove('hidden');
  fillEl.style.width = '5%';
  pctEl.textContent = '5%';

  try {
    const downloadedBlob = await downloadServerSongWithProgress(song.src, (pct) => {
      fillEl.style.width = `${pct}%`;
      pctEl.textContent = `${pct}%`;
    });

    appState.serverSongBlob = downloadedBlob;
    pillEl.textContent = '✓ SIAP';
    pillEl.classList.add('ready');
    setTimeout(() => progressWrap.classList.add('hidden'), 400);

    if (autoPlayPreview) {
      previewManager.playPreviewFromSrcOrBlob(downloadedBlob);
    }
  } catch (err) {
    console.error('Gagal mengunduh lagu server:', err);
    pillEl.textContent = '⬇ UNDUH ULANG';
    progressWrap.classList.add('hidden');
    alert(`Gagal mengunduh "${song.title}". Periksa koneksi internet atau file di server.`);
  } finally {
    appState.isDownloadingSong = false;
  }
}

async function loadBuiltinSongsFromJson() {
  const container = document.getElementById('builtinSongList');
  try {
    const res = await fetch(`${APP_CONFIG.serverAudio.songsManifest}?v=${Date.now()}`);
    if (!res.ok) throw new Error('songs.json tidak ditemukan');
    const songs = await res.json();

    if (!Array.isArray(songs) || songs.length === 0) {
      container.innerHTML = '<div class="loading-songs">Belum ada lagu di daftar server.</div>';
      return;
    }

    const prevSelectedId = appState.selectedSongId;
    container.innerHTML = '';

    for (let idx = 0; idx < songs.length; idx++) {
      const song = songs[idx];
      const isSelected = Boolean(prevSelectedId && song.id === prevSelectedId);
      const existingBlob = await getServerSongBlob(song.src);
      const isDownloaded = existingBlob && existingBlob.size > 1024;
      const scores = getBuiltinHighScores(song.id);

      if (isSelected) {
        appState.serverSongBlob = isDownloaded ? existingBlob : null;
      }

      const card = document.createElement('div');
      card.className = `song-card-3d ${isSelected ? 'selected' : ''}`;
      card.dataset.song = song.id;
      card.dataset.src = song.src;
      card.innerHTML = `
        <div class="song-card-top">
          <div class="song-left">
            <div class="album-3d ${song.color || 'c-cyan'}">${song.icon || '🎵'}</div>
            <div class="song-info">
              <strong>${song.title}</strong>
              <span>${song.subtitle || 'Server Audio'}</span>
            </div>
          </div>
          <span class="status-pill ${isDownloaded ? 'ready' : ''}">
            ${isDownloaded ? '✓ SIAP' : '⬇ UNDUH'}
          </span>
        </div>
        <div class="dl-progress-wrap hidden">
          <div class="dl-track"><div class="dl-fill"></div></div>
          <span class="dl-pct">0%</span>
        </div>
        <div class="history-scores-grid">
          ${buildScoreGridHtml(scores)}
        </div>
      `;

      card.addEventListener('click', () => {
        serverAudioManager.playSfx('buttonClick');
        selectAndPrepareServerSong(song, card, true);
      });

      container.appendChild(card);
    }
  } catch (err) {
    console.warn('Gagal memuat songs.json:', err);
    container.innerHTML = '<div class="loading-songs">Pastikan file assets/audio/songs/songs.json sudah tersedia.</div>';
  }
}

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

  history.forEach((item) => {
    const isSelected = appState.selectedSource === 'local' && appState.selectedSongTitle === item.title;
    const scores = item.scores || { easy: 0, normal: 0, hard: 0, extreme: 0 };

    const div = document.createElement('div');
    div.className = `history-item ${isSelected ? 'active-history' : ''}`;
    div.innerHTML = `
      <div class="history-title-row">
        <strong>🎵 ${item.title}</strong>
        ${isSelected ? '<span class="history-active-pill">DIPILIH</span>' : ''}
      </div>
      <div class="history-scores-grid">
        ${buildScoreGridHtml(scores)}
      </div>
    `;

    div.addEventListener('click', async () => {
      serverAudioManager.playSfx('buttonClick');
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
      revealLevelSection(item.title);
      previewManager.playPreviewFromSrcOrBlob(savedBlob);
    });

    listEl.appendChild(div);
  });
}

// --- 5. MESIN GAME (SLIDE < < <  > > >, DIAGRAM BAR HORIZONTAL) ---
class RhythmEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.isRunning = false;
    this.isPaused = false;
    this.animFrameId = null;

    this.audioCtx = null;
    this.analyser = null;
    this.dataArray = null;
    this.audioEl = null;
    this.localObjectUrl = null;
    this.lastLoadError = '';

    this.notes = [];
    this.particles = [];
    this.shockwaves = [];
    this.laneFlashes = [0, 0, 0, 0];
    this.padPressScale = [1, 1, 1, 1];
    this.comboPulse = 1;
    this.beatPulse = 0;
    this.shakeIntensity = 0;
    this.visualizerBars = new Array(16).fill(0);

    this.activeTouches = new Map();
    this.activeKeys = new Set();

    this.lastSpawnTime = 0;
    this.lastFrameTime = 0;
    this.lastBassEnergy = 0;
    this.songDuration = 60;

    this.life = 100;
    this.score = 0;
    this.combo = 0;
    this.perfectStreak = 0;
    this.missStreak = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.badCount = 0;
    this.lostCount = 0;
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
    this.hitLineY = this.height - 175;
  }

  bindInputs() {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isRunning || this.isPaused) return;
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);

      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const lane = Math.floor(x / (this.width / 4));

      if (lane >= 0 && lane < 4) {
        const hitNote = this.handleLaneDown(lane);
        this.activeTouches.set(e.pointerId, {
          lane,
          startX: x,
          startY: y,
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
      const currentY = e.clientY - rect.top;
      const distance = Math.hypot(currentX - touchData.startX, currentY - touchData.startY);

      if (distance >= 22) {
        this.handleSlideGesture(touchData.lane);
        touchData.startX = currentX;
        touchData.startY = currentY;
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
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
        this.handleSlideGesture(-1);
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
      const titleEl = document.getElementById('countdownSongTitle');
      const levelEl = document.getElementById('countdownLevelBadge');

      const levelInfo = APP_CONFIG.levels[appState.selectedLevel];
      titleEl.textContent = appState.selectedSongTitle;
      levelEl.textContent = `${levelInfo.short} • ${levelInfo.name}`;
      levelEl.style.color = levelInfo.color;

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
    this.lostCount = 0;
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

    const audioSource = appState.selectedSource === 'local'
      ? appState.localAudioBlob
      : (appState.serverSongBlob || appState.selectedSongSrc);

    const loaded = await this.setupAudioStream(audioSource);
    if (!loaded) {
      alert(`Gagal memuat lagu "${appState.selectedSongTitle}".\nPenyebab: ${this.lastLoadError || 'File belum terunduh'}`);
      exitFullScreenToMenu();
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
        this.audioEl = new Audio(encodeURI(source));
      }
      this.audioEl.preload = 'auto';

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Koneksi terlalu lambat (45 detik)')), 45000);
        this.audioEl.addEventListener('loadedmetadata', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        this.audioEl.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('File audio tidak ditemukan atau format rusak'));
        }, { once: true });
        this.audioEl.load();
      });

      const trackNode = this.audioCtx.createMediaElementSource(this.audioEl);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.55;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      trackNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.audioEl.addEventListener('ended', () => this.finishGame(false));
      await this.audioEl.play();
      this.songDuration = this.audioEl.duration || 120;
      return true;
    } catch (err) {
      console.error('Detail error audio:', err.message, source);
      this.lastLoadError = err.message;
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

  processRealTimeBeat(now) {
    if (!this.analyser || !this.dataArray) return;
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];

    this.analyser.getByteFrequencyData(this.dataArray);

    let bassSum = 0;
    for (let i = 1; i <= 8; i++) {
      bassSum += this.dataArray[i];
    }
    const bassAvg = bassSum / 8;

    for (let i = 0; i < this.visualizerBars.length; i++) {
      this.visualizerBars[i] = (this.dataArray[i * 2] || 0) * 0.65;
    }

    const energyDelta = bassAvg - this.lastBassEnergy;
    if (bassAvg > 125 && energyDelta > 9) {
      this.beatPulse = Math.min(1.0, (bassAvg / 245) + (energyDelta / 60));
    }

    if (now - this.lastSpawnTime >= levelCfg.cooldown && bassAvg > levelCfg.beatThreshold && energyDelta > 7) {
      const lane1 = Math.floor(Math.random() * 4);
      const roll = Math.random();

      if (roll < levelCfg.holdChance) {
        const holdLength = 135 + Math.random() * 100;
        this.notes.push({
          type: 'hold',
          lane: lane1,
          y: -35,
          length: holdLength,
          holding: false,
          hit: false,
          tickAccum: 0
        });
        this.lastSpawnTime = now + (holdLength / levelCfg.speed) * 650;
      } else if (levelCfg.slideChance > 0 && roll < levelCfg.holdChance + levelCfg.slideChance) {
        const startLane = Math.floor(Math.random() * 3);
        this.notes.push({
          type: 'slide',
          lane: startLane,
          span: 2,
          y: -35,
          hit: false
        });
        this.lastSpawnTime = now;
      } else {
        this.notes.push({
          type: 'tap',
          lane: lane1,
          y: -35,
          hit: false
        });

        if (Math.random() < levelCfg.doubleChance) {
          const lane2 = (lane1 + 1 + Math.floor(Math.random() * 3)) % 4;
          this.notes.push({
            type: 'tap',
            lane: lane2,
            y: -35,
            hit: false
          });
        }
        this.lastSpawnTime = now;
      }
    }

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

  handleSlideGesture(startLane) {
    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    for (const note of this.notes) {
      if (note.type === 'slide' && !note.hit) {
        const laneMatch = startLane === -1 || startLane === note.lane || startLane === note.lane + 1 || note.touched;
        const diff = Math.abs(note.y - targetY);

        if (laneMatch && diff <= 125) {
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
          serverAudioManager.playSfx('slide');

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

        if (tailY >= this.hitLineY - 55) {
          this.score += 100;
          this.combo++;
          this.perfectCount++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.showFeedback('HOLD CLEAR!', 'anim-good');
          serverAudioManager.playSfx('perfect');
          this.spawnHitEffects(lane);
          this.updateScoreHUD();
        } else {
          this.combo = 0;
          this.perfectStreak = 0;
          this.lostCount++;
          this.showFeedback('LOST', 'anim-lost');
          serverAudioManager.playSfx('tap');
        }
      }
    }
  }

  evaluateTimingHit(minDiff, lane, customPerfectText = null) {
    if (minDiff <= 44) {
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
      serverAudioManager.playSfx('perfect');

      this.shakeIntensity = isMilestone ? 6.5 : 1.5;
      if (navigator.vibrate) navigator.vibrate(isMilestone ? 30 : 14);
    } else if (minDiff <= 78) {
      this.score += 50 + this.combo * 2;
      this.combo++;
      this.perfectStreak = 0;
      this.goodCount++;

      if (this.combo % 10 === 0) {
        this.life = Math.min(100, this.life + 3);
      }

      this.showFeedback('GOOD', 'anim-good');
      serverAudioManager.playSfx('tap');
    } else {
      this.score += 15;
      this.combo = 0;
      this.perfectStreak = 0;
      this.badCount++;

      this.showFeedback('BAD', 'anim-bad');
      serverAudioManager.playSfx('tap');
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
      radius: 20,
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
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.comboPulse = 1.25;
          this.score += 20 + Math.floor(this.combo * 1.5);
          this.updateScoreHUD();
          this.spawnHitEffects(note.lane);
        }

        if (note.y - note.length >= this.hitLineY) {
          note.holding = false;
          note.hit = true;
          this.score += 120;
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.life = Math.min(100, this.life + 3);
          this.showFeedback('HOLD PERFECT!', 'anim-perfect');
          serverAudioManager.playSfx('perfect');
          this.updateScoreHUD();
          this.updateLifeUI();
        }
      } else {
        if (note.y > this.hitLineY + 120) {
          note.hit = true;
          this.combo = 0;
          this.perfectStreak = 0;
          this.missCount++;
          this.missStreak++;
          this.comboPulse = 1.25;
          this.shakeIntensity = 5.5;

          this.life = Math.max(0, this.life - levelCfg.missDamage);
          this.updateLifeUI();
          serverAudioManager.playSfx('miss');

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

  draw3DCapsuleNote(ctx, x, yCenter, w, h, mainColor, shadowColor) {
    const top = yCenter - h / 2;
    const radius = h / 2;

    ctx.fillStyle = shadowColor;
    ctx.beginPath();
    ctx.roundRect(x, top + 6, w, h, radius);
    ctx.fill();

    ctx.fillStyle = mainColor;
    ctx.shadowColor = mainColor;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
    ctx.beginPath();
    ctx.roundRect(x + 10, top + 5, w - 20, 8, 4);
    ctx.fill();
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
      ctx.translate(this.width / 2, this.height * 0.28);
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
      ctx.translate(this.width / 2, this.height * 0.28);
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

    // 4. Tuts Bawah Menyatu
    const keyLabels = ['D', 'F', 'J', 'K'];
    for (let i = 0; i < 4; i++) {
      const padW = laneW - 2;
      const padH = 68;
      const cx = i * laneW + laneW / 2;
      const cy = this.hitLineY + 22;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(this.padPressScale[i], this.padPressScale[i]);

      ctx.fillStyle = this.laneFlashes[i] > 0.15
        ? `rgba(${levelRgb}, 0.42)`
        : 'rgba(255, 255, 255, 0.07)';

      ctx.beginPath();
      ctx.roundRect(-padW / 2, -padH / 2, padW, padH, 16);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = 'bold 13px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(keyLabels[i], 0, 5);
      ctx.restore();
    }

    // 5. Garis Target Berkedip Sesuai Bass
    const pulseAlpha = 0.22 + this.beatPulse * 0.72;
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

    // 6. Gambar Balok Nada 3D Kapsul Lebar
    for (const note of this.notes) {
      if (note.type === 'slide') {
        const x = note.lane * laneW + 2;
        const w = laneW * 2 - 4;
        const h = 46;

        const trailGrad = ctx.createLinearGradient(0, note.y - 70, 0, note.y);
        trailGrad.addColorStop(0, 'rgba(250, 204, 21, 0)');
        trailGrad.addColorStop(1, 'rgba(250, 204, 21, 0.22)');
        ctx.fillStyle = trailGrad;
        ctx.fillRect(x + 6, note.y - 70, w - 12, 70);

        this.draw3DCapsuleNote(ctx, x, note.y, w, h, '#facc15', '#a16207');

        ctx.fillStyle = '#070913';
        ctx.font = '900 15px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('< < <  > > >', x + w / 2, note.y + 5.5);
        continue;
      }

      const x = note.lane * laneW + 2;
      const w = laneW - 4;
      const h = 44;

      if (note.type === 'hold') {
        const headY = note.holding ? this.hitLineY : note.y;
        const tailY = note.y - note.length;
        const bodyH = Math.max(0, headY - tailY);

        ctx.fillStyle = `rgba(${levelRgb}, 0.34)`;
        ctx.beginPath();
        ctx.roundRect(x + 6, tailY, w - 12, bodyH, 16);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.fillRect(x + w / 2 - 2.5, tailY + 8, 5, Math.max(0, bodyH - 16));

        this.draw3DCapsuleNote(ctx, x, headY, w, h, levelColor, 'rgba(0, 0, 0, 0.55)');

        ctx.fillStyle = '#070913';
        ctx.font = '900 11px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HOLD', x + w / 2, headY + 4.5);
      } else {
        const trailGrad = ctx.createLinearGradient(0, note.y - 75, 0, note.y);
        trailGrad.addColorStop(0, `rgba(${levelRgb}, 0)`);
        trailGrad.addColorStop(1, `rgba(${levelRgb}, 0.28)`);
        ctx.fillStyle = trailGrad;
        ctx.fillRect(x + 6, note.y - 75, w - 12, 75);

        this.draw3DCapsuleNote(ctx, x, note.y, w, h, levelColor, 'rgba(0, 0, 0, 0.55)');
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

  calculateGrade(accuracy, isGameOver) {
    if (isGameOver || accuracy < 45) return { grade: 'F', cls: 'grade-f', title: 'Gagal Fokus!', barPct: 12 };
    if (accuracy >= 99 && this.missCount === 0 && this.badCount === 0 && this.lostCount === 0) {
      return { grade: 'SSS', cls: 'grade-sss', title: 'DEWA RITME! SEMPURNA!', barPct: 100 };
    }
    if (accuracy >= 96 && this.missCount === 0 && this.lostCount === 0) {
      return { grade: 'SS', cls: 'grade-ss', title: 'NYARIS SEMPURNA!', barPct: 90 };
    }
    if (accuracy >= 90) return { grade: 'S', cls: 'grade-s', title: 'Luar Biasa! Stres Hilang!', barPct: 78 };
    if (accuracy >= 80) return { grade: 'A', cls: 'grade-a', title: 'Mantap! Ritmemu Stabil!', barPct: 64 };
    if (accuracy >= 70) return { grade: 'B', cls: 'grade-b', title: 'Bagus! Tetap Santuy!', barPct: 50 };
    if (accuracy >= 60) return { grade: 'C', cls: 'grade-c', title: 'Lumayan Buat Lemesin Jari!', barPct: 36 };
    return { grade: 'D', cls: 'grade-d', title: 'Nyaris Kalah, Coba Lagi!', barPct: 24 };
  }

  animateResultBars(totalNotes) {
    const safeTotal = Math.max(1, totalNotes);
    const badTotal = this.badCount + this.lostCount;

    const bars = [
      { id: 'barPerfect', count: this.perfectCount },
      { id: 'barGood', count: this.goodCount },
      { id: 'barBad', count: badTotal },
      { id: 'barMiss', count: this.missCount }
    ];

    bars.forEach((b) => {
      const el = document.getElementById(b.id);
      el.style.width = '0%';
      const pct = Math.round((b.count / safeTotal) * 100);
      requestAnimationFrame(() => {
        el.style.width = `${pct}%`;
      });
    });
  }

  animateScoreCounter(targetScore, highScore, gradeInfo) {
    const scoreEl = document.getElementById('finalScore');
    const highEl = document.getElementById('finalHighScore');
    const rankEl = document.getElementById('resultRank');
    const gradeBarEl = document.getElementById('gradeBarFill');

    rankEl.textContent = '?';
    rankEl.className = 'result-rank';
    gradeBarEl.style.width = '0%';

    requestAnimationFrame(() => {
      gradeBarEl.style.width = `${gradeInfo.barPct}%`;
    });

    const durationMs = 1150;
    const startTime = performance.now();
    let lastTickSound = 0;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.floor(eased * targetScore);

      scoreEl.textContent = currentVal.toLocaleString('id-ID');
      highEl.textContent = Math.max(currentVal, highScore).toLocaleString('id-ID');

      if (targetScore > 0 && now - lastTickSound >= 65 && progress < 1) {
        lastTickSound = now;
        serverAudioManager.playSfx('scoreTick');
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        scoreEl.textContent = targetScore.toLocaleString('id-ID');
        highEl.textContent = highScore.toLocaleString('id-ID');

        rankEl.textContent = gradeInfo.grade;
        rankEl.className = `result-rank ${gradeInfo.cls} grade-stamp`;
        serverAudioManager.playSfx('perfect');
      }
    };

    requestAnimationFrame(step);
  }

  finishGame(isGameOver = false) {
    this.stop();
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
      loadBuiltinSongsFromJson();
    }

    const totalNotes = this.perfectCount + this.goodCount + this.badCount + this.lostCount + this.missCount;
    const accuracy = totalNotes > 0
      ? ((this.perfectCount + this.goodCount * 0.7 + this.badCount * 0.3 + this.lostCount * 0.2) / totalNotes) * 100
      : 100;

    const gradeInfo = this.calculateGrade(accuracy, isGameOver);

    document.getElementById('resultTitle').textContent = isGameOver
      ? 'Game Over!'
      : gradeInfo.title;
    document.getElementById('resultSubtitle').textContent = isGameOver
      ? 'Cobaan terlalu deras, tarik napas dulu lalu coba lagi!'
      : `Akurasi Ketukan: ${accuracy.toFixed(1)}%${this.lostCount > 0 ? ` (${this.lostCount} Hold Lost)` : ''}`;

    document.getElementById('finalHighScoreLabel').textContent = `HIGH (${levelCfg.short})`;
    document.getElementById('finalMaxCombo').textContent = `${this.maxCombo}x`;
    document.getElementById('finalPerfect').textContent = this.perfectCount;
    document.getElementById('finalGood').textContent = this.goodCount;
    document.getElementById('finalBad').textContent = this.badCount + this.lostCount;
    document.getElementById('finalMiss').textContent = this.missCount;

    document.getElementById('resultModal').classList.remove('hidden');
    this.animateResultBars(totalNotes);
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

// --- 6. INTERAKSI UI MENU UTAMA, TUTORIAL & FULLSCREEN TOGGLE ---
let rhythmEngine = null;

function applyThemeColor(levelKey) {
  const color = APP_CONFIG.levels[levelKey].color;
  document.documentElement.style.setProperty('--active-theme', color);
}

function enterFullScreenGame() {
  document.body.classList.add('in-game');
  document.getElementById('menuScreen').classList.remove('active');
  document.getElementById('gameScreen').classList.add('active');
}

function exitFullScreenToMenu() {
  document.body.classList.remove('in-game');
  document.getElementById('gameScreen').classList.remove('active');
  document.getElementById('menuScreen').classList.add('active');
  serverAudioManager.startMenuTheme();
}

function setupUIEvents() {
  serverAudioManager.init();
  rhythmEngine = new RhythmEngine();

  const unlockAudioSystem = () => {
    serverAudioManager.ensureCtx();
    serverAudioManager.startMenuTheme();
    window.removeEventListener('pointerdown', unlockAudioSystem);
    window.removeEventListener('keydown', unlockAudioSystem);
  };
  window.addEventListener('pointerdown', unlockAudioSystem);
  window.addEventListener('keydown', unlockAudioSystem);

  // Tampilkan Tutorial Otomatis saat pertama kali membuka aplikasi
  const tutorialSeen = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'tutorial_seen');
  if (tutorialSeen !== 'true') {
    openTutorialModal();
  }

  document.getElementById('openTutorialBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    openTutorialModal();
  });

  document.getElementById('nextTutorialBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    if (currentTutorialStep < TUTORIAL_STEPS.length - 1) {
      currentTutorialStep++;
      renderTutorialStep();
    } else {
      closeTutorialModal();
    }
  });

  document.getElementById('skipTutorialBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    closeTutorialModal();
  });

  document.getElementById('unselectSongBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    previewManager.stop();
    hideLevelSection();
  });

  const bgmBtn = document.getElementById('bgmToggleBtn');
  bgmBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    serverAudioManager.playSfx('buttonClick');
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

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      previewManager.stop();
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      appState.selectedSource = target;
      document.getElementById(`${target}Tab`).classList.add('active');
    });
  });

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

    serverAudioManager.playSfx('buttonClick');
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '');
    appState.selectedSource = 'local';
    appState.localAudioBlob = file;
    appState.selectedSongTitle = cleanTitle;

    document.getElementById('uploadedFileName').textContent = `✅ ${cleanTitle}`;
    await saveSongBlobToDB(cleanTitle, file);
    saveLocalSongRecord(cleanTitle, appState.selectedLevel, 0);
    revealLevelSection(cleanTitle);
    previewManager.playPreviewFromSrcOrBlob(file);
  });

  document.querySelectorAll('.level-btn-3d').forEach((card) => {
    card.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      document.querySelectorAll('.level-btn-3d').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.selectedLevel = card.dataset.level;
      applyThemeColor(appState.selectedLevel);
    });
  });

  document.getElementById('startGameBtn').addEventListener('click', async () => {
    serverAudioManager.playSfx('buttonClick');
    if (!updateTrialUI()) return;
    serverAudioManager.ensureCtx();

    if (appState.isDownloadingSong) {
      alert('Tunggu sebentar sampai proses unduhan lagu selesai (100%) ya!');
      return;
    }

    if (!appState.selectedSongTitle) {
      alert('Silakan ketuk dan pilih lagu terlebih dahulu ya!');
      return;
    }

    if (appState.selectedSource === 'local' && !appState.localAudioBlob) {
      alert('Pilih file lagu MP3/WAV dari perangkatmu atau dari daftar riwayat terlebih dahulu ya!');
      return;
    }

    if (appState.selectedSource === 'builtin' && !appState.serverSongBlob) {
      const selectedCard = document.querySelector('.song-card-3d.selected');
      if (selectedCard) {
        await selectAndPrepareServerSong(
          {
            id: appState.selectedSongId,
            src: appState.selectedSongSrc,
            title: appState.selectedSongTitle
          },
          selectedCard,
          false
        );
      }
      if (!appState.serverSongBlob) return;
    }

    enterFullScreenGame();
    await rhythmEngine.start();
  });

  document.getElementById('pauseGameBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    rhythmEngine.pause();
  });

  document.getElementById('resumeGameBtn').addEventListener('click', async () => {
    serverAudioManager.playSfx('buttonClick');
    await rhythmEngine.resume();
  });

  document.getElementById('quitToMenuBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    document.getElementById('pauseModal').classList.add('hidden');
    rhythmEngine.stop();
    exitFullScreenToMenu();
  });

  document.getElementById('playAgainBtn').addEventListener('click', async () => {
    serverAudioManager.playSfx('buttonClick');
    serverAudioManager.stopResultMusic();
    document.getElementById('resultModal').classList.add('hidden');
    await rhythmEngine.start();
  });

  document.getElementById('resultMenuBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    serverAudioManager.stopResultMusic();
    document.getElementById('resultModal').classList.add('hidden');
    exitFullScreenToMenu();
  });

  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('sfxToggleCheckbox').addEventListener('change', (e) => {
    appState.sfxEnabled = e.target.checked;
    localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'sfxEnabled', String(appState.sfxEnabled));
    if (appState.sfxEnabled) serverAudioManager.playSfx('buttonClick');
  });

  document.getElementById('offsetSlider').addEventListener('input', (e) => {
    appState.audioOffset = Number(e.target.value);
    document.getElementById('offsetValue').textContent = appState.audioOffset;
  });

  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'offset', String(appState.audioOffset));
    settingsModal.classList.add('hidden');
  });

  document.getElementById('activateBtn').addEventListener('click', () => {
    serverAudioManager.playSfx('buttonClick');
    const code = document.getElementById('licenseInput').value.trim();
    if (!code) {
      alert('Masukkan kode aktivasi dari Lynk.id terlebih dahulu.');
      return;
    }
    alert(`Kode "${code}" siap divalidasi ke Cloudflare Worker pada Tahap 3 & 4!`);
  });
}

// --- 7. PWA SERVICE WORKER & INSTALL PROMPT (BANNER DEPAN + PENGATURAN) ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const frontBanner = document.getElementById('frontInstallBanner');
  const frontBtn = document.getElementById('frontInstallBtn');
  const settingsWrapper = document.getElementById('installWrapper');
  const settingsBtn = document.getElementById('installBtn');

  frontBanner.classList.remove('hidden');
  settingsWrapper.classList.remove('hidden');

  const triggerInstall = async () => {
    serverAudioManager.playSfx('buttonClick');
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      frontBanner.classList.add('hidden');
      settingsWrapper.classList.add('hidden');
    }
    deferredPrompt = null;
  };

  frontBtn.onclick = triggerInstall;
  settingsBtn.onclick = triggerInstall;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('frontInstallBanner').classList.add('hidden');
  document.getElementById('installWrapper').classList.add('hidden');
  deferredPrompt = null;
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
  await loadBuiltinSongsFromJson();
  setupUIEvents();
});
