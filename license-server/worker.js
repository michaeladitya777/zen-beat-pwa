// ZenBeat License Server — Cloudflare Worker
// Menerbitkan TOKEN BERTANDA TANGAN (ECDSA P-256). Aplikasi hanya percaya pada token yang tanda tangannya
// valid, sehingga mengubah flag di localStorage/DevTools tidak lagi membuka versi Pro.

const PRO_TOKEN_MS = 30 * 24 * 3600 * 1000;      // token Pro berlaku 30 hari, diperbarui otomatis saat online
const REFRESH_GRACE_MS = 60 * 24 * 3600 * 1000;  // token kedaluwarsa masih boleh diperbarui sampai 60 hari
const TRIAL_MS = 3 * 24 * 3600 * 1000;
const enc = new TextEncoder();

const b64u = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uDecode = (str) => {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const sha256hex = async (text) => {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

let keyCache = null;
async function getKeys(env) {
  if (keyCache) return keyCache;
  const priv = JSON.parse(env.SIGNING_KEY_JWK);
  const alg = { name: 'ECDSA', namedCurve: 'P-256' };
  const signKey = await crypto.subtle.importKey('jwk', priv, alg, false, ['sign']);
  const pub = { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y };
  const verifyKey = await crypto.subtle.importKey('jwk', pub, alg, false, ['verify']);
  keyCache = { signKey, verifyKey };
  return keyCache;
}

async function signToken(env, payload) {
  const { signKey } = await getKeys(env);
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(body));
  return `${body}.${b64u(new Uint8Array(sig))}`;
}

async function verifyOwnToken(env, token) {
  try {
    const { verifyKey } = await getKeys(env);
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64uDecode(sig), enc.encode(body));
    return ok ? JSON.parse(new TextDecoder().decode(b64uDecode(body))) : null;
  } catch (err) {
    return null;
  }
}

function corsHeaders(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (!allowed.length) h['Access-Control-Allow-Origin'] = '*';
  else if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

// Pembatas percobaan sederhana berbasis KV (cukup untuk menghambat tebak kode / farming trial)
async function allow(env, key, limit, ttlSec) {
  const cur = parseInt((await env.LICENSES.get(key)) || '0', 10);
  if (cur >= limit) return false;
  await env.LICENSES.put(key, String(cur + 1), { expirationTtl: Math.max(60, ttlSec) });
  return true;
}

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{4,39}$/;
const DEVICE_RE = /^ZB-[A-Z0-9]{3,16}-[A-Z0-9]{2,8}$/;

async function readCode(env, code) {
  const hash = await sha256hex(code);
  const key = `code:${hash}`;
  const rec = JSON.parse((await env.LICENSES.get(key)) || 'null');
  return { hash, key, rec };
}

function proToken(env, deviceId, hash, now) {
  return signToken(env, { v: 1, k: 'pro', d: deviceId, ch: hash, iat: now, exp: now + PRO_TOKEN_MS });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: true, service: 'zenbeat-license' }, 200, cors);

    const raw = await request.text();
    if (raw.length > 4096) return json({ valid: false, message: 'Permintaan terlalu besar.' }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch (err) { return json({ valid: false, message: 'Format permintaan salah.' }, 400, cors); }

    const now = Date.now();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const action = body.action || 'activate'; // tanpa "action" = format aplikasi lama

    // ---- Operasi admin (hanya aktif jika ADMIN_TOKEN diatur) ----
    if (action === 'admin_revoke' || action === 'admin_reset') {
      if (!env.ADMIN_TOKEN) return json({ valid: false, message: 'Tidak tersedia.' }, 404, cors);
      if (!(await allow(env, `rl:admin:${ip}`, 20, 3600))) return json({ valid: false, message: 'Terlalu banyak percobaan.' }, 429, cors);
      const [a, b] = await Promise.all([sha256hex(String(body.adminToken || '')), sha256hex(env.ADMIN_TOKEN)]);
      if (a !== b) return json({ valid: false, message: 'Tidak diizinkan.' }, 403, cors);
      const code = String(body.licenseCode || '').trim().toUpperCase();
      const { key, rec } = await readCode(env, code);
      if (!rec) return json({ valid: false, message: 'Kode tidak ditemukan.' }, 404, cors);
      if (action === 'admin_revoke') rec.revoked = body.revoked !== false;
      else rec.devices = [];
      await env.LICENSES.put(key, JSON.stringify(rec));
      return json({ valid: true, message: action === 'admin_revoke' ? (rec.revoked ? 'Kode dicabut.' : 'Kode dipulihkan.') : 'Daftar perangkat dikosongkan.' }, 200, cors);
    }

    const deviceId = String(body.deviceId || '');
    if (!DEVICE_RE.test(deviceId)) return json({ valid: false, message: 'ID perangkat tidak valid.' }, 400, cors);

    // ---- Trial: dicatat di server sehingga hapus data aplikasi / ubah jam tidak memperpanjangnya ----
    if (action === 'trial') {
      const key = `trial:${deviceId}`;
      let rec = JSON.parse((await env.LICENSES.get(key)) || 'null');
      if (!rec) {
        const perDay = Number(env.TRIALS_PER_IP_PER_DAY || 5);
        if (!(await allow(env, `rl:trial:${ip}`, perDay, 86400))) {
          return json({ valid: false, reason: 'rate', message: 'Terlalu banyak trial dari jaringan ini. Aktifkan lisensi atau coba lagi besok.' }, 429, cors);
        }
        rec = { start: now };
        await env.LICENSES.put(key, JSON.stringify(rec), { expirationTtl: 400 * 86400 });
      }
      const token = await signToken(env, { v: 1, k: 'trial', d: deviceId, ts: rec.start, iat: now, exp: rec.start + TRIAL_MS });
      return json({ valid: true, kind: 'trial', token, now }, 200, cors);
    }

    // ---- Aktivasi dengan kode ----
    if (action === 'activate') {
      const code = String(body.licenseCode || '').trim().toUpperCase();
      if (!CODE_RE.test(code)) return json({ valid: false, message: 'Format kode tidak valid.' }, 400, cors);
      if (!(await allow(env, `rl:act:${ip}`, 12, 3600))) {
        return json({ valid: false, message: 'Terlalu banyak percobaan. Coba lagi satu jam lagi.' }, 429, cors);
      }
      const { hash, key, rec } = await readCode(env, code);
      if (!rec || rec.revoked) return json({ valid: false, message: 'Kode aktivasi tidak valid.' }, 200, cors);

      rec.devices = rec.devices || [];
      const max = Number(rec.maxDevices || env.DEFAULT_MAX_DEVICES || 2);
      if (!rec.devices.some((d) => d.id === deviceId)) {
        if (rec.devices.length >= max) {
          return json({ valid: false, message: 'Kode ini sudah dipakai di jumlah perangkat maksimum. Hubungi penjual untuk pindah perangkat.' }, 200, cors);
        }
        rec.devices.push({ id: deviceId, at: now });
        await env.LICENSES.put(key, JSON.stringify(rec));
      }
      const token = await proToken(env, deviceId, hash, now);
      return json({ valid: true, kind: 'pro', message: 'Lisensi berhasil diaktifkan.', token, now }, 200, cors);
    }

    // ---- Perbarui token Pro (validasi ulang berkala, mendeteksi kode yang dicabut) ----
    if (action === 'refresh') {
      const payload = await verifyOwnToken(env, body.token);
      if (!payload || payload.k !== 'pro' || payload.d !== deviceId || now > payload.exp + REFRESH_GRACE_MS) {
        return json({ valid: false, reason: 'token', message: 'Token tidak valid. Masukkan kode aktivasi kembali.' }, 200, cors);
      }
      if (!(await allow(env, `rl:ref:${deviceId}`, 30, 3600))) return json({ valid: false, message: 'Terlalu banyak permintaan.' }, 429, cors);
      const key = `code:${payload.ch}`;
      const rec = JSON.parse((await env.LICENSES.get(key)) || 'null');
      if (!rec || rec.revoked || !(rec.devices || []).some((d) => d.id === deviceId)) {
        return json({ valid: false, revoked: true, reason: 'revoked', message: 'Lisensi sudah tidak berlaku.', now }, 200, cors);
      }
      const token = await proToken(env, deviceId, payload.ch, now);
      return json({ valid: true, kind: 'pro', token, now }, 200, cors);
    }

    return json({ valid: false, message: 'Aksi tidak dikenal.' }, 400, cors);
  }
};
