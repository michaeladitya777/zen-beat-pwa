// Konfigurasi Utama Aplikasi & Lokasi File Audio Server
const APP_CONFIG = {
  licenseApiUrl: 'https://zenbeat-license-api.pulangkantor.workers.dev',
  // Kunci publik untuk memverifikasi token lisensi (hasil: node license-server/tools/generate-keys.mjs).
  // null = mode lama (kurang aman). Isi bersama licenseApiUrl setelah license-server dipasang.
  licensePublicKey: null,
  lynkStoreUrl: 'https://lynk.id/pulangkantor6',
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
      buttonClick: 'assets/audio/sfx/click.mp3'
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
      color: '#6ee7b7',
      rgb: '110, 231, 183',
      speed: 280,
      cooldown: 640,
      doubleChance: 0,
      holdChance: 0.16,
      slideChance: 0,
      slideCooldownMs: 999999,
      beatThreshold: 172,
      missDamage: 7
    },
    normal: {
      name: 'Mode Biasa Aja',
      short: 'NORMAL',
      color: '#7dd3fc',
      rgb: '125, 211, 252',
      speed: 390,
      cooldown: 430,
      doubleChance: 0.05,
      holdChance: 0.20,
      slideChance: 0,
      slideCooldownMs: 999999,
      beatThreshold: 158,
      missDamage: 9
    },
    hard: {
      name: 'Kebut Semalam',
      short: 'HARD',
      color: '#ffb454',
      rgb: '255, 180, 84',
      speed: 520,
      cooldown: 245,
      doubleChance: 0.14,
      holdChance: 0.22,
      slideChance: 0.10,
      slideCooldownMs: 1850,
      beatThreshold: 144,
      missDamage: 10
    },
    extreme: {
      name: 'Mode WNI',
      short: 'EXTREME',
      color: '#ff5d7a',
      rgb: '255, 93, 122',
      speed: 650,
      cooldown: 165,
      doubleChance: 0.28,
      holdChance: 0.22,
      slideChance: 0.13,
      slideCooldownMs: 1500,
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
  licenseMode: 'legacy',
  licenseKind: null,
  licenseIat: 0,
  licenseExp: 0,
  trialEndsAt: null,
  provisional: false,
  needsRevalidate: false,
  licenseNote: '',
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
  isDownloadingSong: false,
  analysis: null,
  chartJob: null
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- 1. INDEXEDDB (LISENSI, LAGU LOKAL & CACHE UNDUHAN LAGU SERVER) ---
function openAppDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ZenBeatAppDB', 6);
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
      if (!db.objectStoreNames.contains('charts')) {
        db.createObjectStore('charts', { keyPath: 'key' });
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
  const rnd = (n) => {
    const bytes = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  return `ZB-${rnd(5)}-${rnd(2)}`;
}

// --- LISENSI AMAN: token bertanda tangan dari license-server ---
const DAY_MS = 24 * 60 * 60 * 1000;

function b64uToBytes(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const LicenseSecure = {
  _key: null,
  get enabled() {
    return Boolean(APP_CONFIG.licensePublicKey && window.crypto && crypto.subtle);
  },
  async verify(token) {
    try {
      if (!this._key) {
        this._key = crypto.subtle.importKey('jwk', APP_CONFIG.licensePublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      }
      const [body, sig] = String(token).split('.');
      if (!body || !sig) return null;
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await this._key, b64uToBytes(sig), new TextEncoder().encode(body));
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(body)));
      return payload && payload.v === 1 ? payload : null;
    } catch (err) {
      return null;
    }
  },
  async call(body, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(APP_CONFIG.licenseApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
};

// Jam tepercaya: tidak bisa diputar mundur (disinkronkan ke waktu server tiap kali online)
function trustedNow() {
  if (appState.licenseMode !== 'secure') return Date.now();
  const last = Number(localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'lastSeen')) || 0;
  return Math.max(Date.now(), last);
}
function touchClock() {
  if (appState.licenseMode === 'secure') {
    localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'lastSeen', String(trustedNow()));
  }
}
function syncClock(serverNow) {
  if (Number.isFinite(serverNow)) localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'lastSeen', String(serverNow));
}

function applyLicensePayload(p) {
  const now = trustedNow();
  appState.licenseKind = p.k;
  appState.licenseIat = p.iat || 0;
  appState.licenseExp = p.exp || 0;
  appState.isActivated = p.k === 'pro' && now < p.exp;
  appState.needsRevalidate = p.k === 'pro' && now >= p.exp;
  appState.trialEndsAt = p.k === 'trial' ? p.exp : null;
}

async function acceptToken(resp) {
  if (!resp || !resp.token) return false;
  const payload = await LicenseSecure.verify(resp.token);
  if (!payload || payload.d !== appState.deviceId) return false;
  await setPersistedValue('licenseToken', resp.token);
  syncClock(Number(resp.now) || payload.iat);
  appState.provisional = false;
  applyLicensePayload(payload);
  return true;
}

// Belum punya token: pindahkan lisensi lama (kode yang pernah disimpan) atau mulai trial dari server
async function acquireInitialToken(skipLegacy = false) {
  try {
    if (!skipLegacy) {
      const flag = await getPersistedValue('isActivated');
      const code = await getPersistedValue('licenseCode');
      if ((flag === 'true' || flag === true) && code) {
        const r = await LicenseSecure.call({ action: 'activate', licenseCode: String(code), deviceId: appState.deviceId });
        if (r && r.valid && (await acceptToken(r))) {
          await setPersistedValue('isActivated', 'false');
          await setPersistedValue('licenseCode', '');
          return true;
        }
      }
    }
    const t = await LicenseSecure.call({ action: 'trial', deviceId: appState.deviceId });
    if (t && t.token && (await acceptToken(t))) return true;
    if (t && t.reason === 'rate') {
      appState.licenseNote = t.message || '';
      appState.trialEndsAt = 0;
      appState.provisional = false;
      return false;
    }
  } catch (err) {
    /* offline atau server tidak terjangkau */
  }
  // Tanpa koneksi: trial lokal sementara, diselaraskan dengan server begitu online
  appState.provisional = true;
  appState.trialEndsAt = appState.firstLaunch + APP_CONFIG.trialDurationMs;
  return false;
}

async function refreshLicense() {
  if (!LicenseSecure.enabled || appState.licenseKind !== 'pro') return false;
  const token = await getPersistedValue('licenseToken');
  if (!token) return false;
  try {
    const r = await LicenseSecure.call({ action: 'refresh', token, deviceId: appState.deviceId });
    if (r && (r.revoked || r.reason === 'revoked' || r.reason === 'token')) {
      syncClock(Number(r.now));
      await setPersistedValue('licenseToken', '');
      appState.isActivated = false;
      appState.licenseKind = null;
      appState.needsRevalidate = false;
      await acquireInitialToken(true);
      updateTrialUI();
      return false;
    }
    if (r && r.valid && (await acceptToken(r))) {
      updateTrialUI();
      return true;
    }
  } catch (err) {
    /* offline: token yang ada tetap dipakai sampai kedaluwarsa */
  }
  updateTrialUI();
  return false;
}

async function initLicenseSecure() {
  appState.licenseMode = 'secure';
  touchClock();
  setInterval(touchClock, 60 * 1000);

  const stored = await getPersistedValue('licenseToken');
  let payload = stored ? await LicenseSecure.verify(stored) : null;
  if (payload && payload.d !== appState.deviceId) payload = null;

  if (payload) applyLicensePayload(payload);
  else await acquireInitialToken();

  if (appState.licenseKind === 'pro') {
    if (appState.needsRevalidate) await refreshLicense();
    else if (trustedNow() - appState.licenseIat > 7 * DAY_MS) refreshLicense();
  }
}

function getTrialRemainingMs() {
  if (appState.licenseMode === 'secure' || appState.provisional) {
    return (appState.trialEndsAt || 0) - trustedNow();
  }
  return APP_CONFIG.trialDurationMs - (Date.now() - appState.firstLaunch);
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

  if (LicenseSecure.enabled) {
    await initLicenseSecure();
  } else {
    console.warn('Mode lisensi lama aktif (licensePublicKey belum diisi): status Pro bisa diubah lewat DevTools.');
    const activated = await getPersistedValue('isActivated');
    appState.isActivated = activated === 'true' || activated === true;
  }

  const savedOffset = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'offset');
  const offsetSlider = document.getElementById('offsetSlider');
  const offsetValue = document.getElementById('offsetValue');
  if (savedOffset && offsetSlider && offsetValue) {
    appState.audioOffset = Number(savedOffset);
    offsetSlider.value = appState.audioOffset;
    offsetValue.textContent = appState.audioOffset;
  }

  const savedSfx = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'sfxEnabled');
  appState.sfxEnabled = savedSfx !== 'false';
  const sfxCheckbox = document.getElementById('sfxToggleCheckbox');
  if (sfxCheckbox) sfxCheckbox.checked = appState.sfxEnabled;

  const devDisplay = document.getElementById('deviceIdDisplay');
  const paywallDevDisplay = document.getElementById('paywallDeviceId');
  if (devDisplay) devDisplay.textContent = deviceId;
  if (paywallDevDisplay) paywallDevDisplay.textContent = deviceId;

  updateTrialUI();
  renderLocalHistory();
}

function openUpgradeModal(isExpired = false, reason = '') {
  const paywallModal = document.getElementById('paywallModal');
  if (!paywallModal) return;

  ['paywallBuyLink', 'settingsBuyLink'].forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.href = APP_CONFIG.lynkStoreUrl;
  });

  const titleEl = document.getElementById('paywallTitle');
  const infoEl = document.getElementById('paywallInfo');
  const revalidateBtn = document.getElementById('revalidateBtn');
  const revalidate = reason === 'revalidate';

  if (titleEl) {
    titleEl.textContent = revalidate ? 'Lisensi perlu divalidasi ulang' : (isExpired ? 'Masa trial 3 hari selesai' : 'Upgrade ke ZenBeat Pro');
  }
  if (infoEl) {
    infoEl.textContent = revalidate
      ? 'Lisensimu masih terdaftar, tetapi sudah lama tidak diverifikasi. Hubungkan internet lalu tekan Validasi ulang.'
      : (appState.licenseNote || 'Aktifkan lisensi permanen untuk main tanpa batas di perangkat ini.');
  }
  if (revalidateBtn) revalidateBtn.classList.toggle('hidden', !revalidate);

  const closeBtn = document.getElementById('closeEarlyUpgradeBtn');
  if (closeBtn) closeBtn.classList.toggle('hidden', isExpired);

  paywallModal.classList.remove('hidden');
}

function updateTrialUI() {
  touchClock();
  if (appState.licenseMode === 'secure' && appState.licenseKind === 'pro') {
    // masa berlaku token dicek ulang setiap saat, bukan hanya saat dimuat
    const valid = trustedNow() < appState.licenseExp;
    appState.isActivated = valid;
    appState.needsRevalidate = !valid;
  }
  syncLicenseUI();
  const badge = document.getElementById('trialBadge');
  if (!badge) return true;

  if (appState.isActivated) {
    badge.textContent = '★ Pro';
    badge.classList.add('activated');
    badge.style.cursor = 'default';
    badge.onclick = null;
    return true;
  }

  if (appState.needsRevalidate) {
    badge.textContent = 'Validasi ulang';
    badge.style.cursor = 'pointer';
    badge.onclick = () => {
      serverAudioManager.playSfx('buttonClick');
      openUpgradeModal(true, 'revalidate');
    };
    openUpgradeModal(true, 'revalidate');
    return false;
  }

  const remaining = getTrialRemainingMs();

  if (remaining <= 0) {
    badge.textContent = 'Trial habis — beli';
    badge.style.cursor = 'pointer';
    badge.onclick = () => {
      serverAudioManager.playSfx('buttonClick');
      openUpgradeModal(true);
    };
    openUpgradeModal(true);
    return false;
  }

  const hoursLeft = Math.floor(remaining / (1000 * 60 * 60));
  const daysLeft = Math.floor(hoursLeft / 24);
  const remHours = hoursLeft % 24;

  badge.textContent = `Trial ${daysLeft} hari ${remHours} jam`;
  badge.style.cursor = 'pointer';
  badge.title = 'Klik untuk beli lisensi permanen';
  badge.onclick = () => {
    serverAudioManager.playSfx('buttonClick');
    openUpgradeModal(false);
  };
  return true;
}

// --- 2. SERVER AUDIO MANAGER ---
const serverAudioManager = {
  menuAudio: null,
  resultAudio: null,
  sfxBuffers: {},
  sfxHtmlElements: {},
  missing: new Set(),
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
    const entries = Object.entries(APP_CONFIG.serverAudio.sfx);

    entries.forEach(([key, src]) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      this.sfxHtmlElements[key] = audio;
    });

    const ctx = this.ensureCtx();
    await Promise.all(entries.map(async ([key, src]) => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(arrayBuf);
        this.sfxBuffers[key] = audioBuf;
      } catch (err) {
        // File tidak ada / gagal dimuat: pakai suara sintesis bawaan
        this.missing.add(key);
        delete this.sfxHtmlElements[key];
      }
    }));
  },

  startFallbackSynthMenu() {
    if (this.isPlayingSynth || !appState.bgmEnabled) return;
    const gameScreen = document.getElementById('gameScreen');
    if (gameScreen && gameScreen.classList.contains('active')) return;

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
      const gs = document.getElementById('gameScreen');
      if (gs && gs.classList.contains('active')) {
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
    const gameScreen = document.getElementById('gameScreen');
    if (gameScreen && gameScreen.classList.contains('active')) return;
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

  synth(type) {
    const ctx = this.sharedCtx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const tone = (freq, start, dur, vol, wave = 'sine', endFreq = null) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, t + start);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + start + dur);
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + start);
      osc.stop(t + start + dur + 0.02);
    };
    switch (type) {
      case 'tap': tone(520, 0, 0.07, 0.22, 'triangle'); break;
      case 'perfect': tone(880, 0, 0.12, 0.2); tone(1319, 0.05, 0.18, 0.16); break;
      case 'slide': tone(420, 0, 0.16, 0.2, 'triangle', 980); break;
      case 'miss': tone(180, 0, 0.18, 0.22, 'sawtooth', 90); break;
      case 'scoreTick': tone(1400, 0, 0.03, 0.08, 'square'); break;
      default: break;
    }
  },

  playSfx(type) {
    if (!appState.sfxEnabled) return;
    if (this.missing.has(type)) {
      this.synth(type);
      return;
    }

    const buffer = this.sfxBuffers[type];
    if (buffer && this.sharedCtx && this.sharedCtx.state === 'running') {
      const source = this.sharedCtx.createBufferSource();
      const gainNode = this.sharedCtx.createGain();
      source.buffer = buffer;
      gainNode.gain.value = type === 'scoreTick' ? 0.5 : 1.0;
      source.connect(gainNode);
      gainNode.connect(this.sharedCtx.destination);
      source.start(0);
      return;
    }

    const htmlEl = this.sfxHtmlElements[type];
    if (htmlEl) {
      htmlEl.pause();
      htmlEl.currentTime = 0;
      htmlEl.volume = type === 'scoreTick' ? 0.5 : 1.0;
      htmlEl.play().catch(() => {
        this.ensureCtx();
      });
    }
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
  const badgeEl = document.getElementById('tutorialStepBadge');
  const visualEl = document.getElementById('tutorialVisual');
  const titleEl = document.getElementById('tutorialTitle');
  const descEl = document.getElementById('tutorialDesc');
  const nextBtn = document.getElementById('nextTutorialBtn');

  if (badgeEl) badgeEl.textContent = `Langkah ${currentTutorialStep + 1} dari ${TUTORIAL_STEPS.length}`;
  if (visualEl) visualEl.textContent = step.visual;
  if (titleEl) titleEl.textContent = step.title;
  if (descEl) descEl.textContent = step.desc;

  document.querySelectorAll('.t-dot').forEach((dot, idx) => {
    dot.classList.toggle('active', idx === currentTutorialStep);
  });

  if (nextBtn) {
    nextBtn.textContent = currentTutorialStep === TUTORIAL_STEPS.length - 1 ? 'Selesai ✓' : 'Lanjut ▶';
  }
}

function openTutorialModal() {
  const modal = document.getElementById('tutorialModal');
  if (!modal) return;
  currentTutorialStep = 0;
  renderTutorialStep();
  modal.classList.remove('hidden');
}

function closeTutorialModal() {
  const modal = document.getElementById('tutorialModal');
  if (modal) modal.classList.add('hidden');
  localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'tutorial_seen', 'true');
}

// --- ANALISIS CHART (offline, hasil disimpan per lagu) ---
async function getCachedAnalysis(key, size) {
  try {
    const db = await openAppDB();
    return await new Promise((resolve) => {
      const req = db.transaction('charts', 'readonly').objectStore('charts').get(key);
      req.onsuccess = () => {
        const r = req.result;
        resolve(r && r.version === ChartAnalyzer.VERSION && r.size === size ? r : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

async function saveAnalysis(key, size, data) {
  try {
    const db = await openAppDB();
    await new Promise((resolve) => {
      const tx = db.transaction('charts', 'readwrite');
      tx.objectStore('charts').put({ key, size, version: ChartAnalyzer.VERSION, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    /* cache gagal tersimpan: analisis akan diulang lain kali */
  }
}

function setChartStatus(text, state) {
  const el = document.getElementById('chartStatus');
  if (!el) return;
  el.textContent = text;
  el.className = `chart-status ${state || ''}`.trim();
}

function setAnalyzeProgress(p) {
  const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
  const fill = document.getElementById('analyzeFill');
  const label = document.getElementById('analyzePct');
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
}

function cancelChartPrep() {
  if (appState.chartJob) appState.chartJob.ctrl.cancelled = true;
  appState.chartJob = null;
  appState.analysis = null;
  setChartStatus('', '');
}

function startChartPrep(blob, key) {
  const current = appState.chartJob;
  if (current && current.key === key && current.size === blob.size && !current.error && !current.ctrl.cancelled) return current;

  cancelChartPrep();
  const ctrl = { cancelled: false };
  const job = { key, size: blob.size, ctrl, error: null, promise: null };
  appState.chartJob = job;

  if (typeof ChartAnalyzer === 'undefined') {
    job.error = new Error('Modul analisis tidak termuat');
    setChartStatus('Chart gagal dibuat', 'error');
    job.promise = Promise.resolve(null);
    return job;
  }

  const onProgress = (p) => {
    setChartStatus(`Menyiapkan chart... ${Math.round(p * 100)}%`, 'busy');
    setAnalyzeProgress(p);
  };

  job.promise = (async () => {
    onProgress(0);
    let rec = await getCachedAnalysis(key, blob.size);
    if (!rec) {
      const data = await ChartAnalyzer.analyzeBlob(blob, onProgress, ctrl);
      rec = { key, size: blob.size, version: ChartAnalyzer.VERSION, data };
      await saveAnalysis(key, blob.size, data);
    }
    if (ctrl.cancelled) return null;
    appState.analysis = rec;
    setChartStatus(`Chart siap • ${Math.round(rec.data.bpm)} BPM`, 'ready');
    return rec;
  })().catch((err) => {
    if (!ctrl.cancelled) {
      console.error('Analisis chart gagal:', err);
      job.error = err;
      setChartStatus('Chart gagal dibuat', 'error');
    }
    return null;
  });
  return job;
}

// Dipanggil saat tombol Mulai: tunggu analisis selesai (biasanya sudah selesai di latar belakang)
async function ensureChartReady() {
  if (appState.analysis) return true;
  const job = appState.chartJob;
  if (!job) return false;

  const modal = document.getElementById('analyzeModal');
  const cancelBtn = document.getElementById('analyzeCancelBtn');
  if (modal) modal.classList.remove('hidden');

  let waitCancelled = false;
  const cancelPromise = new Promise((resolve) => {
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        waitCancelled = true;
        resolve(null);
      };
    }
  });

  const rec = await Promise.race([job.promise, cancelPromise]);
  if (modal) modal.classList.add('hidden');
  if (waitCancelled) return false;
  if (!rec) {
    alert(`Chart untuk lagu ini gagal dibuat.\nPenyebab: ${job.error ? job.error.message : 'tidak diketahui'}`);
    return false;
  }
  return true;
}

// --- 4. PEMILIHAN LAGU, REVEAL LEVEL & HIGH SCORE ---
function revealLevelSection(songTitle) {
  const section = document.getElementById('levelActionSection');
  const caption = document.getElementById('selectedSongCaption');
  if (caption) caption.textContent = `Lagu terpilih: ${songTitle}`;
  if (section) {
    section.classList.remove('hidden');
  }
}

function hideLevelSection() {
  const section = document.getElementById('levelActionSection');
  if (section) section.classList.add('hidden');
  document.querySelectorAll('.song-card').forEach((el) => el.classList.remove('selected'));
  document.querySelectorAll('.history-item').forEach((el) => el.classList.remove('active-history'));
  appState.selectedSongId = '';
  appState.selectedSongSrc = '';
  appState.selectedSongTitle = '';
  appState.serverSongBlob = null;
  appState.localAudioBlob = null;
  cancelChartPrep();
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
  if (!levelKeys.some((lk) => (scores[lk] || 0) > 0)) return '';
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

  document.querySelectorAll('.song-card').forEach((el) => {
    el.classList.remove('selected');
  });
  if (cardEl) cardEl.classList.add('selected');

  appState.selectedSource = 'builtin';
  appState.selectedSongId = song.id;
  appState.selectedSongSrc = song.src;
  appState.selectedSongTitle = song.title;

  revealLevelSection(song.title);

  const pillEl = cardEl ? cardEl.querySelector('.status-pill') : null;
  const progressWrap = cardEl ? cardEl.querySelector('.dl-progress-wrap') : null;
  const fillEl = cardEl ? cardEl.querySelector('.dl-fill') : null;
  const pctEl = cardEl ? cardEl.querySelector('.dl-pct') : null;

  let cachedBlob = await getServerSongBlob(song.src);
  if (cachedBlob && cachedBlob.size > 1024) {
    appState.serverSongBlob = cachedBlob;
    if (pillEl) {
      pillEl.textContent = '✓ SIAP';
      pillEl.classList.add('ready');
    }
    if (progressWrap) progressWrap.classList.add('hidden');
    startChartPrep(cachedBlob, `srv:${song.src}`);
    if (autoPlayPreview) {
      previewManager.playPreviewFromSrcOrBlob(cachedBlob);
    }
    return;
  }

  appState.isDownloadingSong = true;
  appState.serverSongBlob = null;
  if (pillEl) pillEl.textContent = 'MENGUNDUH...';
  if (progressWrap) progressWrap.classList.remove('hidden');
  if (fillEl) fillEl.style.width = '5%';
  if (pctEl) pctEl.textContent = '5%';

  try {
    const downloadedBlob = await downloadServerSongWithProgress(song.src, (pct) => {
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (pctEl) pctEl.textContent = `${pct}%`;
    });

    appState.serverSongBlob = downloadedBlob;
    if (pillEl) {
      pillEl.textContent = '✓ SIAP';
      pillEl.classList.add('ready');
    }
    setTimeout(() => {
      if (progressWrap) progressWrap.classList.add('hidden');
    }, 400);

    startChartPrep(downloadedBlob, `srv:${song.src}`);
    if (autoPlayPreview) {
      previewManager.playPreviewFromSrcOrBlob(downloadedBlob);
    }
  } catch (err) {
    console.error('Gagal mengunduh lagu server:', err);
    if (pillEl) pillEl.textContent = '⬇ UNDUH ULANG';
    if (progressWrap) progressWrap.classList.add('hidden');
    alert(`Gagal mengunduh "${song.title}". Periksa koneksi internet atau file di server.`);
  } finally {
    appState.isDownloadingSong = false;
  }
}

let songListRenderId = 0;

async function loadBuiltinSongsFromJson() {
  const container = document.getElementById('builtinSongList');
  if (!container) return;
  const renderId = ++songListRenderId; // cegah daftar ganda jika dipanggil bersamaan

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
      if (renderId !== songListRenderId) return;
      const isDownloaded = existingBlob && existingBlob.size > 1024;
      const scores = getBuiltinHighScores(song.id);

      if (isSelected) {
        appState.serverSongBlob = isDownloaded ? existingBlob : null;
      }

      const subtitleText = song.subtitle && !/auto sync/i.test(song.subtitle) ? song.subtitle : 'Lagu bawaan';
      const card = document.createElement('div');
      card.className = `song-card ${isSelected ? 'selected' : ''}`;
      card.dataset.song = song.id;
      card.dataset.src = song.src;
      card.innerHTML = `
        <div class="song-card-top">
          <div class="song-left">
            <div class="album ${['c-cyan', 'c-purple', 'c-amber'].includes(song.color) ? song.color : 'c-cyan'}">${escapeHtml(song.icon || '🎵')}</div>
            <div class="song-info">
              <strong>${escapeHtml(song.title)}</strong>
              <span>${escapeHtml(subtitleText)}</span>
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
  if (!wrapper || !listEl) return;

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
        <strong>🎵 ${escapeHtml(item.title)}</strong>
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
        const fileInput = document.getElementById('audioFileInput');
        if (fileInput) fileInput.click();
        return;
      }

      appState.selectedSource = 'local';
      appState.localAudioBlob = savedBlob;
      appState.selectedSongTitle = item.title;

      const uploadedEl = document.getElementById('uploadedFileName');
      if (uploadedEl) uploadedEl.textContent = `✅ ${item.title}`;
      renderLocalHistory();
      revealLevelSection(item.title);
      startChartPrep(savedBlob, `loc:${item.title}`);
      previewManager.playPreviewFromSrcOrBlob(savedBlob);
    });

    listEl.appendChild(div);
  });
}

// --- 5. MESIN GAME (ANTI-TUMPUK SLIDER & AUTO-PAUSE SAAT MINIMIZE/KELUAR) ---
class RhythmEngine {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.isRunning = false;
    this.isPaused = false;
    this.isCountingDown = false;
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
    this.lastSlideSpawnTime = 0;
    this.lastFrameTime = 0;
    this.lastBassEnergy = 0;
    this.songDuration = 60;
    this.lastLaneDownAt = [-1e9, -1e9, -1e9, -1e9];
    this.chart = [];
    this.chartIdx = 0;
    this.songTime = 0;
    this.timeEst = 0;
    this.lastAT = -1;
    this.travelSec = 1;
    this.latencySec = 0;
    this.audioStarted = false;
    this.audioEnded = false;
    this.clockLocked = false;
    this.startWait = 0;
    this.endWait = 0;

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

    if (this.canvas) {
      this.bindInputs();
    }
  }

  resizeCanvas() {
    if (!this.canvas || !this.ctx) return;
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
    window.addEventListener('resize', () => {
      if (document.body.classList.contains('in-game')) this.resizeCanvas();
    });

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
          noteRef: hitNote,
          slideTriggered: false
        });
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isRunning || this.isPaused) return;
      const touchData = this.activeTouches.get(e.pointerId);
      if (!touchData || touchData.slideTriggered) return;

      const rect = this.canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      const distance = Math.hypot(currentX - touchData.startX, currentY - touchData.startY);

      if (distance >= 26) {
        const didHitSlide = this.handleSlideGesture(touchData.lane);
        if (didHitSlide) {
          touchData.slideTriggered = true;
        }
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
      this.isCountingDown = true;
      const overlay = document.getElementById('countdownOverlay');
      const textEl = document.getElementById('countdownText');
      const titleEl = document.getElementById('countdownSongTitle');
      const levelEl = document.getElementById('countdownLevelBadge');

      if (!overlay || !textEl) {
        this.isCountingDown = false;
        resolve();
        return;
      }

      const levelInfo = APP_CONFIG.levels[appState.selectedLevel];
      if (titleEl) titleEl.textContent = appState.selectedSongTitle;
      if (levelEl) {
        levelEl.textContent = `${levelInfo.short} • ${levelInfo.name}`;
        levelEl.style.color = levelInfo.color;
      }

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
          this.isCountingDown = false;
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
    this.lastSlideSpawnTime = 0;
    this.lastBassEnergy = 0;
    this.beatPulse = 0;
    this.audioStarted = false;
    this.audioEnded = false;
    this.clockLocked = false;
    this.lastAT = -1;
    this.startWait = 0;
    this.endWait = 0;
    this.lastLaneDownAt = [-1e9, -1e9, -1e9, -1e9];

    // Chart disusun dari hasil analisis lagu (deterministik per lagu dan level)
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    if (!appState.analysis || typeof ChartAnalyzer === 'undefined') {
      alert('Chart belum siap. Pilih ulang lagunya ya.');
      exitFullScreenToMenu();
      return;
    }
    this.chart = ChartAnalyzer.buildChart(
      appState.analysis.data, levelCfg, appState.analysis.key + '|' + appState.selectedLevel, appState.selectedLevel
    );
    this.chartIdx = 0;
    if (this.chart.length < 8) {
      alert('Lagu ini terlalu datar untuk dibuatkan chart. Coba lagu lain.');
      exitFullScreenToMenu();
      return;
    }
    this.travelSec = (this.hitLineY + 35) / levelCfg.speed;

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

    // Jeda awal selama waktu turun balok, supaya balok pertama muncul dari atas layar.
    // songTime = posisi lagu yang sedang TERDENGAR (waktu audio dikurangi latensi keluaran).
    this.latencySec = Math.min(0.4, (this.audioCtx.baseLatency || 0) + (this.audioCtx.outputLatency || 0));
    this.timeEst = -(this.travelSec + 0.35);
    this.songTime = this.timeEst - this.latencySec;

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

      this.audioEl.addEventListener('ended', () => {
        this.audioEnded = true;
      });
      this.songDuration = this.audioEl.duration || (appState.analysis ? appState.analysis.data.duration : 120);
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
    if (this.audioEl && !this.audioEl.paused) {
      this.audioEl.pause();
    }
    const pauseModal = document.getElementById('pauseModal');
    if (pauseModal) pauseModal.classList.remove('hidden');
  }

  async resume() {
    if (!this.isRunning || !this.isPaused) return;
    const pauseModal = document.getElementById('pauseModal');
    if (pauseModal) pauseModal.classList.add('hidden');
    await this.runCountdown();

    this.isPaused = false;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
    if (this.audioEl && this.audioStarted && !this.audioEnded) {
      await this.audioEl.play();
      this.clockLocked = false; // sinkron ulang dengan posisi audio setelah jeda
      this.lastAT = -1;
      this.startWait = 0;
    }

    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  // Visualizer & denyut garis target (tidak lagi menentukan balok)
  updateVisualizer() {
    if (!this.analyser || !this.dataArray) return;
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
    this.lastBassEnergy = bassAvg * 0.90;
  }

  // Jam lagu: audio.currentTime terlalu kasar untuk animasi, jadi diperhalus dengan jam frame
  updateSongClock(dt) {
    if (!this.audioStarted) {
      this.timeEst += dt;
      if (this.timeEst >= 0) {
        this.timeEst = 0;
        this.audioStarted = true;
        this.audioEl.play().catch((err) => console.warn('Audio gagal mulai:', err.message));
      }
    } else if (this.audioEl && !this.audioEnded) {
      const at = this.audioEl.currentTime;
      if (!this.clockLocked) {
        if (at > 0) {
          this.clockLocked = true;
          this.timeEst = at;
          this.lastAT = at;
        }
      } else {
        this.timeEst += dt;
        if (at !== this.lastAT) {
          this.lastAT = at;
          const err = at - this.timeEst;
          this.timeEst += Math.abs(err) > 0.2 ? err : err * 0.3;
        }
      }
    } else if (this.clockLocked) {
      this.timeEst += dt; // audio sudah selesai, jam jalan sendiri
    }
    this.songTime = this.timeEst - this.latencySec;
  }

  nowSongTime() {
    if (!this.isRunning || this.isPaused) return this.songTime;
    return this.songTime + Math.min(0.05, (performance.now() - this.lastFrameTime) / 1000);
  }

  refreshNoteY(st) {
    const time = st === undefined ? this.nowSongTime() : st;
    const speed = APP_CONFIG.levels[appState.selectedLevel].speed;
    for (const n of this.notes) {
      n.y = this.hitLineY - (n.t - time) * speed;
    }
  }

  spawnUpcoming(st) {
    const speed = APP_CONFIG.levels[appState.selectedLevel].speed;
    const horizon = st + this.travelSec;
    while (this.chartIdx < this.chart.length && this.chart[this.chartIdx].t <= horizon) {
      const c = this.chart[this.chartIdx++];
      const note = { type: c.type, lane: c.lane, t: c.t, y: this.hitLineY - (c.t - st) * speed, hit: false };
      if (c.type === 'hold') {
        note.length = c.dur * speed;
        note.holding = false;
        note.ticks = c.ticks || [];
        note.tickIdx = 0;
      } else if (c.type === 'slide') {
        note.span = c.span;
      }
      this.notes.push(note);
    }
  }

  handleLaneDown(lane) {
    this.refreshNoteY();
    this.laneFlashes[lane] = 1.0;
    this.padPressScale[lane] = 0.88;

    // Anti-dobel: satu sentuhan/tombol kadang terkirim dua kali dan "memakan" balok di dekatnya
    const nowMs = performance.now();
    if (nowMs - this.lastLaneDownAt[lane] < 45) return null;
    this.lastLaneDownAt[lane] = nowMs;

    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    let tapNote = null, tapDiff = Infinity;
    let slideNote = null, slideDiff = Infinity;

    for (const note of this.notes) {
      if (note.hit || note.holding) continue;
      const diff = Math.abs(note.y - targetY);
      if (note.type === 'slide') {
        if ((lane === note.lane || lane === note.lane + 1) && diff < slideDiff) {
          slideDiff = diff;
          slideNote = note;
        }
      } else if (note.lane === lane && diff < tapDiff) {
        tapDiff = diff;
        tapNote = note;
      }
    }

    // Tap/hold didahulukan. Slide hanya "tersentuh" jika tidak ada tap yang layak dalam jangkauan,
    // supaya ketukan tidak diserap slide lalu keduanya hilang sebagai MISS.
    let closestNote = null;
    let minDiff = Infinity;
    if (tapNote && tapDiff <= 105 && (tapDiff <= 78 || tapDiff <= slideDiff)) {
      closestNote = tapNote;
      minDiff = tapDiff;
    } else if (slideNote && slideDiff <= 105) {
      closestNote = slideNote;
      minDiff = slideDiff;
    } else if (tapNote && tapDiff <= 105) {
      closestNote = tapNote;
      minDiff = tapDiff;
    }
    if (!closestNote) return null;

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
    this.refreshNoteY();
    const offsetPixels = (appState.audioOffset / 1000) * APP_CONFIG.levels[appState.selectedLevel].speed;
    const targetY = this.hitLineY + offsetPixels;

    let targetSlide = null;
    let minDiff = Infinity;

    for (const note of this.notes) {
      if (note.type === 'slide' && !note.hit) {
        const laneMatch = startLane === -1 || startLane === note.lane || startLane === note.lane + 1 || note.touched;
        const diff = Math.abs(note.y - targetY);

        if (laneMatch && diff <= 115 && diff < minDiff) {
          minDiff = diff;
          targetSlide = note;
        }
      }
    }

    if (!targetSlide) return false;

    targetSlide.hit = true;
    this.missStreak = 0;
    this.laneFlashes[targetSlide.lane] = 1.0;
    this.laneFlashes[targetSlide.lane + 1] = 1.0;

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
    this.spawnHitEffects(targetSlide.lane);
    this.spawnHitEffects(targetSlide.lane + 1);
    this.updateScoreHUD();
    this.updateLifeUI();
    if (navigator.vibrate) navigator.vibrate(20);
    return true;
  }

  handleLaneRelease(lane) {
    this.refreshNoteY();
    for (const note of this.notes) {
      if (note.type === 'hold' && note.lane === lane && note.holding && !note.hit) {
        const tailY = note.y - note.length;
        note.holding = false;
        note.hit = true;

        if (tailY >= this.hitLineY - 55) {
          // dilepas tepat di ujung: beat yang tersisa tetap dihitung PERFECT
          const remaining = Math.max(0, (note.ticks ? note.ticks.length : 0) - (note.tickIdx || 0));
          for (let i = 0; i < remaining; i++) this.registerHoldBeat(lane, true);
          this.score += 100;
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

  // Satu beat nada tahan = satu PERFECT (skor, combo, dan streak sama seperti ketukan biasa)
  registerHoldBeat(lane, silent = false) {
    this.missStreak = 0;
    this.score += 100 + this.combo * 5;
    this.combo++;
    this.perfectStreak++;
    this.perfectCount++;
    this.life = Math.min(100, this.life + (this.combo % 10 === 0 ? 4 : 1));
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboPulse = 1.25;
    if (!silent) {
      const isMilestone = this.perfectStreak >= 25 && this.perfectStreak % 25 === 0;
      const label = this.perfectStreak > 1 ? `PERFECT x${this.perfectStreak}` : 'PERFECT!';
      this.showFeedback(label, isMilestone ? 'anim-perfect-milestone' : 'anim-perfect');
      serverAudioManager.playSfx('tap');
      this.spawnHitEffects(lane);
    }
    this.updateScoreHUD();
    this.updateLifeUI();
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
    if (!el) return;
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
    const scoreEl = document.getElementById('scoreDisplay');
    if (scoreEl) scoreEl.textContent = this.score;
  }

  updateLifeUI() {
    const fillEl = document.getElementById('lifeBarFill');
    const textEl = document.getElementById('lifePercentText');
    const clamped = Math.max(0, Math.round(this.life));

    if (fillEl) {
      fillEl.style.width = `${clamped}%`;
      if (clamped <= 30) {
        fillEl.classList.add('danger');
      } else {
        fillEl.classList.remove('danger');
      }
    }
    if (textEl) {
      textEl.textContent = `${clamped}%`;
      textEl.style.color = clamped <= 30 ? '#f43f5e' : '#ffffff';
    }
  }

  loop(timestamp) {
    if (!this.isRunning || this.isPaused) return;

    const nowPerf = performance.now();
    const dt = Math.min(0.05, (nowPerf - this.lastFrameTime) / 1000);
    this.lastFrameTime = nowPerf;

    this.updateSongClock(dt);
    const st = this.songTime;
    if (this.audioEl && !isNaN(this.audioEl.duration)) this.songDuration = this.audioEl.duration;

    const progressPct = Math.min(100, (Math.max(0, st) / this.songDuration) * 100);
    const progBar = document.getElementById('songProgressBar');
    if (progBar) progBar.style.width = `${progressPct}%`;

    if (this.audioStarted && !this.clockLocked && !this.audioEnded) {
      this.startWait += dt;
      if (this.startWait > 5) {
        alert('Audio tidak bisa diputar. Coba ketuk layar lalu mulai lagi.');
        exitFullScreenToMenu();
        return;
      }
    }

    this.updateVisualizer();
    this.spawnUpcoming(st);
    this.refreshNoteY(st);

    // Selesai: lagu habis, semua balok sudah selesai dinilai
    if (this.chartIdx >= this.chart.length && this.notes.length === 0 && (this.audioEnded || st >= this.songDuration)) {
      this.endWait += dt;
      if (this.endWait > 0.8) {
        this.finishGame(false);
        return;
      }
    }

    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    for (const note of this.notes) {
      if (note.hit) continue;

      if (note.type === 'hold' && note.holding) {
        this.laneFlashes[note.lane] = 0.85;
        this.padPressScale[note.lane] = 0.9;
        // Combo dan PERFECT dihitung per beat selama nada ditahan
        const ticks = note.ticks || [];
        while (note.tickIdx < ticks.length && st >= ticks[note.tickIdx]) {
          note.tickIdx++;
          this.registerHoldBeat(note.lane);
        }

        if (note.y - note.length >= this.hitLineY) {
          note.holding = false;
          note.hit = true;
          this.score += 120;
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

  drawNote(ctx, x, yCenter, w, h, color) {
    const top = yCenter - h / 2;
    const r = h * 0.42;
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, r);
    ctx.fill();
    ctx.shadowBlur = 0;

    const sheen = ctx.createLinearGradient(0, top, 0, top + h);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
    sheen.addColorStop(1, 'rgba(40, 10, 50, 0.28)');
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x + 1.5, top + 1.5, w - 3, h - 3, r - 1);
    ctx.stroke();
    ctx.restore();
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const laneW = W / 4;
    const levelCfg = APP_CONFIG.levels[appState.selectedLevel];
    const color = levelCfg.color;
    const rgb = levelCfg.rgb;
    const font = (weight, size) => `${weight} ${size}px "Baloo 2", Nunito, sans-serif`;

    ctx.save();
    if (this.shakeIntensity > 0.1) {
      ctx.translate((Math.random() - 0.5) * this.shakeIntensity, (Math.random() - 0.5) * this.shakeIntensity);
    }
    ctx.clearRect(0, 0, W, H);

    // Jalur: belang halus bergantian, pembatas tipis
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 244, 232, 0.028)';
        ctx.fillRect(i * laneW, 0, laneW, H);
      }
      if (i > 0) {
        ctx.fillStyle = 'rgba(255, 244, 232, 0.07)';
        ctx.fillRect(i * laneW - 0.5, 0, 1, H);
      }
    }

    // Visualizer musik: batang bulat di belakang
    const barCount = this.visualizerBars.length;
    const barW = W / barCount;
    for (let i = 0; i < barCount; i++) {
      const barH = Math.min(this.visualizerBars[i] * 1.5, this.hitLineY * 0.7);
      if (barH < 3) continue;
      ctx.fillStyle = `rgba(${rgb}, 0.11)`;
      ctx.beginPath();
      ctx.roundRect(i * barW + 3, this.hitLineY - barH, barW - 6, barH, 7);
      ctx.fill();
    }

    // Angka kombo / rentetan miss
    const showMiss = this.combo <= 1 && this.missStreak > 1;
    if (this.combo > 1 || showMiss) {
      ctx.save();
      ctx.translate(W / 2, H * 0.27);
      ctx.scale(this.comboPulse, this.comboPulse);
      ctx.textAlign = 'center';
      const label = showMiss ? `${this.missStreak}x` : `${this.combo}`;
      ctx.font = font(800, 88);
      ctx.fillStyle = showMiss ? 'rgba(255, 93, 122, 0.3)' : 'rgba(255, 244, 232, 0.14)';
      ctx.fillText(label, 0, 0);
      ctx.font = font(700, 15);
      ctx.fillStyle = showMiss ? 'rgba(255, 93, 122, 0.7)' : 'rgba(255, 244, 232, 0.45)';
      ctx.fillText(showMiss ? 'Miss beruntun' : 'Kombo', 0, 24);
      ctx.restore();
    }

    // Sorotan jalur saat diketuk
    for (let i = 0; i < 4; i++) {
      if (this.laneFlashes[i] > 0) {
        const grad = ctx.createLinearGradient(0, this.hitLineY - 260, 0, this.hitLineY + 40);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(1, `rgba(${rgb}, ${this.laneFlashes[i] * 0.32})`);
        ctx.fillStyle = grad;
        ctx.fillRect(i * laneW, this.hitLineY - 260, laneW, 300);
      }
    }

    // Tombol ketuk di bawah
    const keyLabels = ['D', 'F', 'J', 'K'];
    for (let i = 0; i < 4; i++) {
      const padW = laneW - 12;
      const padH = 58;
      const cx = i * laneW + laneW / 2;
      const cy = this.hitLineY + 42;
      const pressed = this.laneFlashes[i] > 0.15;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(this.padPressScale[i], this.padPressScale[i]);
      if (pressed) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
      }
      ctx.fillStyle = pressed ? `rgba(${rgb}, 0.5)` : 'rgba(255, 244, 232, 0.07)';
      ctx.beginPath();
      ctx.roundRect(-padW / 2, -padH / 2, padW, padH, 20);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = pressed ? `rgba(${rgb}, 0.95)` : 'rgba(255, 244, 232, 0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = pressed ? '#ffffff' : 'rgba(255, 244, 232, 0.3)';
      ctx.font = font(700, 15);
      ctx.textAlign = 'center';
      ctx.fillText(keyLabels[i], 0, 5);
      ctx.restore();
    }

    // Garis target berdenyut mengikuti bass
    ctx.save();
    ctx.strokeStyle = `rgba(${rgb}, ${0.28 + this.beatPulse * 0.7})`;
    ctx.lineWidth = 2 + this.beatPulse * 3.5;
    ctx.lineCap = 'round';
    if (this.beatPulse > 0.15) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 16 * this.beatPulse;
    }
    ctx.beginPath();
    ctx.moveTo(8, this.hitLineY);
    ctx.lineTo(W - 8, this.hitLineY);
    ctx.stroke();
    ctx.restore();

    // Balok nada
    for (const note of this.notes) {
      if (note.type === 'slide') {
        const x = note.lane * laneW + 3;
        const w = laneW * 2 - 6;
        const h = 46;
        const trail = ctx.createLinearGradient(0, note.y - 70, 0, note.y);
        trail.addColorStop(0, 'rgba(196, 181, 253, 0)');
        trail.addColorStop(1, 'rgba(196, 181, 253, 0.25)');
        ctx.fillStyle = trail;
        ctx.fillRect(x + 8, note.y - 70, w - 16, 70);
        this.drawNote(ctx, x, note.y, w, h, '#c4b5fd');
        ctx.fillStyle = '#2a1850';
        ctx.font = font(800, 18);
        ctx.textAlign = 'center';
        ctx.fillText('‹‹‹   ›››', x + w / 2, note.y + 6);
        continue;
      }

      const x = note.lane * laneW + 4;
      const w = laneW - 8;
      const h = 44;

      if (note.type === 'hold') {
        const headY = note.holding ? this.hitLineY : note.y;
        const tailY = note.y - note.length;
        const bodyH = Math.max(0, headY - tailY);
        ctx.fillStyle = `rgba(${rgb}, 0.3)`;
        ctx.beginPath();
        ctx.roundRect(x + 8, tailY, w - 16, bodyH, 18);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.roundRect(x + w / 2 - 2.5, tailY + 8, 5, Math.max(0, bodyH - 16), 3);
        ctx.fill();
        this.drawNote(ctx, x, headY, w, h, color);
        ctx.fillStyle = '#2a1850';
        ctx.font = font(800, 13);
        ctx.textAlign = 'center';
        ctx.fillText('Tahan', x + w / 2, headY + 5);
      } else {
        const trail = ctx.createLinearGradient(0, note.y - 75, 0, note.y);
        trail.addColorStop(0, `rgba(${rgb}, 0)`);
        trail.addColorStop(1, `rgba(${rgb}, 0.26)`);
        ctx.fillStyle = trail;
        ctx.fillRect(x + 8, note.y - 75, w - 16, 75);
        this.drawNote(ctx, x, note.y, w, h, color);
      }
    }

    // Gelombang dan percikan
    for (const sw of this.shockwaves) {
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rgb}, ${Math.max(0, sw.alpha)})`;
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
      if (!el) return;
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

    if (rankEl) {
      rankEl.textContent = '?';
      rankEl.className = 'result-rank';
    }
    if (gradeBarEl) {
      gradeBarEl.style.width = '0%';
      requestAnimationFrame(() => {
        gradeBarEl.style.width = `${gradeInfo.barPct}%`;
      });
    }

    const durationMs = 1150;
    const startTime = performance.now();
    let lastTickSound = 0;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.floor(eased * targetScore);

      if (scoreEl) scoreEl.textContent = currentVal.toLocaleString('id-ID');
      if (highEl) highEl.textContent = Math.max(currentVal, highScore).toLocaleString('id-ID');

      if (targetScore > 0 && now - lastTickSound >= 65 && progress < 1) {
        lastTickSound = now;
        serverAudioManager.playSfx('scoreTick');
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        if (scoreEl) scoreEl.textContent = targetScore.toLocaleString('id-ID');
        if (highEl) highEl.textContent = highScore.toLocaleString('id-ID');

        if (rankEl) {
          rankEl.textContent = gradeInfo.grade;
          rankEl.className = `result-rank ${gradeInfo.cls} grade-stamp`;
        }
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

    const titleEl = document.getElementById('resultTitle');
    const subEl = document.getElementById('resultSubtitle');
    const highLabelEl = document.getElementById('finalHighScoreLabel');
    const maxComboEl = document.getElementById('finalMaxCombo');
    const perfEl = document.getElementById('finalPerfect');
    const goodEl = document.getElementById('finalGood');
    const badEl = document.getElementById('finalBad');
    const missEl = document.getElementById('finalMiss');
    const resultModal = document.getElementById('resultModal');

    if (titleEl) titleEl.textContent = isGameOver ? 'Game Over!' : gradeInfo.title;
    if (subEl) {
      subEl.textContent = isGameOver
        ? 'Cobaan terlalu deras, tarik napas dulu lalu coba lagi!'
        : `Akurasi Ketukan: ${accuracy.toFixed(1)}%${this.lostCount > 0 ? ` (${this.lostCount} Hold Lost)` : ''}`;
    }
    if (highLabelEl) highLabelEl.textContent = `HIGH (${levelCfg.short})`;
    if (maxComboEl) maxComboEl.textContent = `${this.maxCombo}x`;
    if (perfEl) perfEl.textContent = this.perfectCount;
    if (goodEl) goodEl.textContent = this.goodCount;
    if (badEl) badEl.textContent = this.badCount + this.lostCount;
    if (missEl) missEl.textContent = this.missCount;
    if (resultModal) resultModal.classList.remove('hidden');

    this.animateResultBars(totalNotes);
    this.animateScoreCounter(this.score, highScore, gradeInfo);
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.isCountingDown = false;
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

// --- 6. AUTO-PAUSE SAAT APLIKASI KELUAR / MINIMIZE & EVENT UI ---
let rhythmEngine = null;

function handleAppBackgrounded() {
  if (rhythmEngine && rhythmEngine.isRunning && !rhythmEngine.isPaused) {
    rhythmEngine.pause();
  }
  previewManager.stop();
  serverAudioManager.stopMenuTheme();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    handleAppBackgrounded();
  } else {
    if (!document.body.classList.contains('in-game')) {
      serverAudioManager.startMenuTheme();
    }
  }
});

window.addEventListener('pagehide', handleAppBackgrounded);
window.addEventListener('blur', () => {
  if (rhythmEngine && rhythmEngine.isRunning && !rhythmEngine.isPaused) {
    rhythmEngine.pause();
  }
});

function applyThemeColor(levelKey) {
  const color = APP_CONFIG.levels[levelKey].color;
  document.documentElement.style.setProperty('--active-theme', color);
}

function enterFullScreenGame() {
  document.body.classList.add('in-game');
  const menuScreen = document.getElementById('menuScreen');
  const gameScreen = document.getElementById('gameScreen');
  if (menuScreen) menuScreen.classList.remove('active');
  if (gameScreen) gameScreen.classList.add('active');
}

function exitFullScreenToMenu() {
  document.body.classList.remove('in-game');
  const gameScreen = document.getElementById('gameScreen');
  const menuScreen = document.getElementById('menuScreen');
  if (gameScreen) gameScreen.classList.remove('active');
  if (menuScreen) menuScreen.classList.add('active');
  serverAudioManager.startMenuTheme();
}

function lockZoomGestures() {
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) => document.addEventListener(ev, stop, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}

function setupUIEvents() {
  lockZoomGestures();
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

  const openTutBtn = document.getElementById('openTutorialBtn');
  if (openTutBtn) {
    openTutBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      openTutorialModal();
    });
  }

  const nextTutBtn = document.getElementById('nextTutorialBtn');
  if (nextTutBtn) {
    nextTutBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      if (currentTutorialStep < TUTORIAL_STEPS.length - 1) {
        currentTutorialStep++;
        renderTutorialStep();
      } else {
        closeTutorialModal();
      }
    });
  }

  const skipTutBtn = document.getElementById('skipTutorialBtn');
  if (skipTutBtn) {
    skipTutBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      closeTutorialModal();
    });
  }

  const unselectBtn = document.getElementById('unselectSongBtn');
  if (unselectBtn) {
    unselectBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      previewManager.stop();
      hideLevelSection();
    });
  }

  const bgmBtn = document.getElementById('bgmToggleBtn');
  if (bgmBtn) {
    bgmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      serverAudioManager.playSfx('buttonClick');
      appState.bgmEnabled = !appState.bgmEnabled;
      if (appState.bgmEnabled) {
        bgmBtn.textContent = '🎵 On';
        bgmBtn.classList.remove('muted');
        serverAudioManager.startMenuTheme();
      } else {
        bgmBtn.textContent = '🔇 Off';
        bgmBtn.classList.add('muted');
        serverAudioManager.stopMenuTheme();
      }
    });
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      previewManager.stop();
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      appState.selectedSource = target;
      const targetTab = document.getElementById(`${target}Tab`);
      if (targetTab) targetTab.classList.add('active');
    });
  });

  const fileInput = document.getElementById('audioFileInput');
  if (fileInput) {
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

      const uploadedNameEl = document.getElementById('uploadedFileName');
      if (uploadedNameEl) uploadedNameEl.textContent = `✅ ${cleanTitle}`;
      await saveSongBlobToDB(cleanTitle, file);
      saveLocalSongRecord(cleanTitle, appState.selectedLevel, 0);
      revealLevelSection(cleanTitle);
      startChartPrep(file, `loc:${cleanTitle}`);
      previewManager.playPreviewFromSrcOrBlob(file);
    });
  }

  document.querySelectorAll('.level-row').forEach((card) => {
    card.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      document.querySelectorAll('.level-row').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      appState.selectedLevel = card.dataset.level;
      applyThemeColor(appState.selectedLevel);
    });
  });

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
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
        const selectedCard = document.querySelector('.song-card.selected');
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

      if (!(await ensureChartReady())) return;

      enterFullScreenGame();
      await rhythmEngine.start();
    });
  }

  const pauseBtn = document.getElementById('pauseGameBtn');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      rhythmEngine.pause();
    });
  }

  const resumeBtn = document.getElementById('resumeGameBtn');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', async () => {
      serverAudioManager.playSfx('buttonClick');
      await rhythmEngine.resume();
    });
  }

  const quitBtn = document.getElementById('quitToMenuBtn');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      const pauseModal = document.getElementById('pauseModal');
      if (pauseModal) pauseModal.classList.add('hidden');
      rhythmEngine.stop();
      exitFullScreenToMenu();
    });
  }

  const playAgainBtn = document.getElementById('playAgainBtn');
  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', async () => {
      serverAudioManager.playSfx('buttonClick');
      serverAudioManager.stopResultMusic();
      const resultModal = document.getElementById('resultModal');
      if (resultModal) resultModal.classList.add('hidden');
      await rhythmEngine.start();
    });
  }

  const resultMenuBtn = document.getElementById('resultMenuBtn');
  if (resultMenuBtn) {
    resultMenuBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      serverAudioManager.stopResultMusic();
      const resultModal = document.getElementById('resultModal');
      if (resultModal) resultModal.classList.add('hidden');
      exitFullScreenToMenu();
    });
  }

  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      settingsModal.classList.remove('hidden');
    });
  }

  const sfxToggle = document.getElementById('sfxToggleCheckbox');
  if (sfxToggle) {
    sfxToggle.addEventListener('change', (e) => {
      appState.sfxEnabled = e.target.checked;
      localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'sfxEnabled', String(appState.sfxEnabled));
      if (appState.sfxEnabled) serverAudioManager.playSfx('buttonClick');
    });
  }

  const offsetSlider = document.getElementById('offsetSlider');
  if (offsetSlider) {
    offsetSlider.addEventListener('input', (e) => {
      appState.audioOffset = Number(e.target.value);
      const offsetVal = document.getElementById('offsetValue');
      if (offsetVal) offsetVal.textContent = appState.audioOffset;
    });
  }

  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      localStorage.setItem(APP_CONFIG.storageKeyPrefix + 'offset', String(appState.audioOffset));
      settingsModal.classList.add('hidden');
    });
  }

  // Aktivasi lisensi (modal paywall dan pengaturan memakai fungsi yang sama)
  const activateBtn = document.getElementById('activateBtn');
  if (activateBtn) {
    activateBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      const input = document.getElementById('licenseInput');
      activateLicense(input ? input.value.trim().toUpperCase() : '', activateBtn, 'Aktifkan sekarang', 'Memeriksa kode...');
    });
  }

  const settingsActivateBtn = document.getElementById('settingsActivateBtn');
  if (settingsActivateBtn) {
    settingsActivateBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      const input = document.getElementById('settingsLicenseInput');
      activateLicense(input ? input.value.trim().toUpperCase() : '', settingsActivateBtn, 'Aktifkan', 'Cek...');
    });
  }

  const revalidateBtn = document.getElementById('revalidateBtn');
  if (revalidateBtn) {
    revalidateBtn.addEventListener('click', async () => {
      serverAudioManager.playSfx('buttonClick');
      revalidateBtn.disabled = true;
      revalidateBtn.textContent = 'Memeriksa...';
      const ok = await refreshLicense();
      revalidateBtn.disabled = false;
      revalidateBtn.textContent = 'Validasi ulang lisensi';
      if (ok) {
        const paywallModal = document.getElementById('paywallModal');
        if (paywallModal) paywallModal.classList.add('hidden');
      } else {
        alert('Belum berhasil. Pastikan internet aktif lalu coba lagi.');
      }
    });
  }

  window.addEventListener('online', async () => {
    if (!LicenseSecure.enabled) return;
    if (appState.provisional) {
      await acquireInitialToken();
      updateTrialUI();
    } else if (appState.licenseKind === 'pro' && (appState.needsRevalidate || trustedNow() - appState.licenseIat > 7 * DAY_MS)) {
      await refreshLicense();
    }
  });

  const closeEarlyBtn = document.getElementById('closeEarlyUpgradeBtn');
  if (closeEarlyBtn) {
    closeEarlyBtn.addEventListener('click', () => {
      serverAudioManager.playSfx('buttonClick');
      const paywallModal = document.getElementById('paywallModal');
      if (paywallModal) paywallModal.classList.add('hidden');
    });
  }
}

// --- 7. PWA SERVICE WORKER, INSTALL SEBELUM TUTORIAL & AKTIVASI DI PENGATURAN ---
let deferredPrompt = null;

function isRunningAsInstalledPWA() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function syncLicenseUI() {
  const form = document.getElementById('licenseFormArea');
  const active = document.getElementById('licenseActiveArea');
  if (form) form.classList.toggle('hidden', appState.isActivated);
  if (active) active.classList.toggle('hidden', !appState.isActivated);
}

async function activateLicense(code, btn, idleText, busyText) {
  if (!code) {
    alert('Masukkan kode aktivasi dari Lynk.id terlebih dahulu.');
    return;
  }

  if (LicenseSecure.enabled) {
    btn.disabled = true;
    btn.textContent = busyText;
    try {
      const r = await LicenseSecure.call({ action: 'activate', licenseCode: code, deviceId: appState.deviceId });
      if (r && r.valid && (await acceptToken(r)) && appState.isActivated) {
        updateTrialUI();
        const paywallModal = document.getElementById('paywallModal');
        if (paywallModal) paywallModal.classList.add('hidden');
        alert(r.message || 'Lisensi berhasil diaktifkan.');
      } else {
        alert((r && r.message) || 'Kode aktivasi tidak valid atau tidak bisa diverifikasi.');
      }
    } catch (err) {
      alert('Gagal terhubung ke server aktivasi. Pastikan koneksi internet aktif.');
    } finally {
      btn.disabled = false;
      btn.textContent = idleText;
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = busyText;

  try {
    const response = await fetch(APP_CONFIG.licenseApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseCode: code, deviceId: appState.deviceId })
    });
    const data = await response.json();

    if (data.valid) {
      appState.isActivated = true;
      await setPersistedValue('isActivated', 'true');
      await setPersistedValue('licenseCode', code);
      updateTrialUI();
      const paywallModal = document.getElementById('paywallModal');
      if (paywallModal) paywallModal.classList.add('hidden');
      alert(data.message || 'Lisensi berhasil diaktifkan.');
    } else {
      alert(data.message || 'Kode aktivasi tidak valid.');
    }
  } catch (err) {
    alert('Gagal terhubung ke server aktivasi. Pastikan koneksi internet aktif.');
  } finally {
    btn.disabled = false;
    btn.textContent = idleText;
  }
}

async function triggerInstallPromptAction() {
  serverAudioManager.playSfx('buttonClick');
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') {
      ['installBanner', 'installWrapper'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      return true;
    }
    return false;
  }

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIOS) {
    alert('Cara pasang ZenBeat di iPhone/iPad:\n1. Ketuk ikon Share (kotak dengan panah ke atas) di Safari.\n2. Pilih "Add to Home Screen" (Tambah ke Layar Utama).');
  } else {
    alert('Cara pasang ZenBeat ke layar utama:\n1. Ketuk ikon titik tiga (⋮) di pojok kanan atas browser.\n2. Pilih "Install aplikasi" atau "Tambahkan ke layar utama".');
  }
  return false;
}

// Jendela ajakan pasang hanya muncul sekali, sebelum tutorial pertama
function showFirstTimeInstallBeforeTutorial() {
  return new Promise((resolve) => {
    const seenKey = APP_CONFIG.storageKeyPrefix + 'install_prompt_seen';
    const modal = document.getElementById('installModal');
    if (!modal || isRunningAsInstalledPWA() || localStorage.getItem(seenKey) === 'true') {
      resolve();
      return;
    }

    const finish = () => {
      localStorage.setItem(seenKey, 'true');
      modal.classList.add('hidden');
      resolve();
    };

    modal.classList.remove('hidden');
    document.getElementById('modalInstallNowBtn').onclick = async () => {
      await triggerInstallPromptAction();
      finish();
    };
    document.getElementById('modalSkipInstallBtn').onclick = () => {
      serverAudioManager.playSfx('buttonClick');
      finish();
    };
  });
}

function ensureInstallUI() {
  const installWrapper = document.getElementById('installWrapper');
  const installBtn = document.getElementById('installBtn');
  const banner = document.getElementById('installBanner');
  const bannerBtn = document.getElementById('installBannerBtn');

  if (isRunningAsInstalledPWA()) {
    if (banner) banner.classList.add('hidden');
    if (installWrapper) installWrapper.classList.add('hidden');
    return;
  }

  if (installWrapper) installWrapper.classList.remove('hidden');
  if (installBtn) installBtn.onclick = triggerInstallPromptAction;

  // Spanduk hanya muncul jika browser benar-benar bisa memasang (atau di iOS)
  const canPrompt = Boolean(deferredPrompt) || /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (banner) banner.classList.toggle('hidden', !canPrompt);
  if (bannerBtn) bannerBtn.onclick = triggerInstallPromptAction;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  ensureInstallUI();
});

window.addEventListener('appinstalled', () => {
  ['installBanner', 'installWrapper', 'installModal'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  deferredPrompt = null;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      reg.update();
    }).catch((err) => {
      console.warn('SW gagal terdaftar:', err);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  ensureInstallUI();
  try {
    await initTrialAndDevice();
    await loadBuiltinSongsFromJson();
    setupUIEvents();
    syncLicenseUI();
    ensureInstallUI();

    // Tampilkan layar Install Aplikasi dulu sebelum Tutorial muncul
    await showFirstTimeInstallBeforeTutorial();
    const tutorialSeen = localStorage.getItem(APP_CONFIG.storageKeyPrefix + 'tutorial_seen');
    if (tutorialSeen !== 'true') {
      openTutorialModal();
    }
  } catch (err) {
    console.error('Error saat memuat ZenBeat:', err);
  }
});
