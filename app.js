// Konfigurasi Utama Aplikasi
const APP_CONFIG = {
  trialDurationMs: 3 * 24 * 60 * 60 * 1000, // 3 Hari (72 Jam) dalam milidetik
  storageKeyPrefix: 'zenbeat_v1_',
  levels: {
    easy: { name: 'Mode Santuy', speed: 3.2, cooldown: 650, doubleChance: 0 },
    normal: { name: 'Mode Biasa Aja', speed: 4.8, cooldown: 420, doubleChance: 0.05 },
    hard: { name: 'Mode Sistem Kebut Semalam (SKS)', speed: 6.8, cooldown: 230, doubleChance: 0.15 },
    extreme: { name: 'Mode WNI', speed: 9.0, cooldown: 140, doubleChance: 0.35 }
  }
};

// State Aplikasi
const appState = {
  deviceId: null,
  firstLaunch: null,
  isActivated: false,
  selectedSource: 'builtin', // 'builtin' | 'local'
  selectedSongId: 'lofi-chill',
  selectedSongTitle: 'Hujan Sore di Kantor',
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
        // Ambil nilai yang paling awal/valid agar tidak mudah di-reset
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

// --- 2. INTERAKSI UI MENU UTAMA ---
function setupUIEvents() {
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
  document.getElementById('startGameBtn').addEventListener('click', () => {
    if (!updateTrialUI()) return;

    if (appState.selectedSource === 'local' && !appState.localAudioFile) {
      alert('Pilih file lagu MP3/WAV dari perangkatmu terlebih dahulu ya!');
      return;
    }

    const levelInfo = APP_CONFIG.levels[appState.selectedLevel];
    document.getElementById('hudSongTitle').textContent = appState.selectedSongTitle;
    document.getElementById('hudLevelName').textContent = levelInfo.name;
    document.getElementById('selectedSummary').textContent =
      `Lagu: "${appState.selectedSongTitle}" • Tingkat: ${levelInfo.name}`;

    document.getElementById('menuScreen').classList.remove('active');
    document.getElementById('gameScreen').classList.add('active');
  });

  // Tombol Kembali ke Menu
  document.getElementById('backToMenuBtn').addEventListener('click', () => {
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

  // Placeholder Tombol Aktivasi (Akan dihubungkan ke Cloudflare Worker di Tahap 3 & 4)
  document.getElementById('activateBtn').addEventListener('click', () => {
    const code = document.getElementById('licenseInput').value.trim();
    if (!code) {
      alert('Masukkan kode aktivasi dari Lynk.id terlebih dahulu.');
      return;
    }
    alert(`Kode "${code}" siap divalidasi ke Cloudflare Worker pada Tahap 3 & 4!`);
  });
}

// --- 3. PWA SERVICE WORKER & INSTALL PROMPT ---
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

// Jalankan Inisialisasi
document.addEventListener('DOMContentLoaded', async () => {
  await initTrialAndDevice();
  setupUIEvents();
});
