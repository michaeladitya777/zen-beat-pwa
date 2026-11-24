# ZenBeat License Server

Server lisensi (Cloudflare Worker) yang menerbitkan **token bertanda tangan**. Aplikasi hanya percaya pada token yang
tanda tangannya valid, jadi mengubah flag di DevTools/localStorage tidak lagi membuka versi Pro.

## Yang dilindungi
- **Status Pro** = token ECDSA yang terikat ke ID perangkat. Flag `isActivated` lama diabaikan.
- **Validasi ulang berkala**: token Pro berlaku 30 hari dan diperbarui otomatis saat online. Kode yang dicabut berhenti
  berlaku di perangkat saat validasi berikutnya.
- **Batas perangkat per kode** (default 2) dan **pembatas percobaan** (tebak kode, farming trial) di sisi server.
- **Trial dicatat di server**: menghapus data aplikasi tidak mengulang trial pada ID yang sama, dan jam yang diputar
  mundur tidak memperpanjangnya.

## Yang TIDAK bisa dicegah
Aplikasi ini file JavaScript statis di GitHub Pages. Orang yang mau bisa menyalin repo, menghapus pengecekan lisensi,
lalu menghosting versi sendiri. Tujuan sistem ini adalah membuat pembajakan santai (ubah flag, ganti jam, bagi-bagi
kode) jauh lebih merepotkan daripada membeli kode. Jangan menyimpan rahasia apa pun di sisi aplikasi.

## Pemasangan (sekali saja)
Butuh Node 18+ dan akun Cloudflare.

1. `cd license-server && npm i -D wrangler` lalu `npx wrangler login`.
2. Buat KV: `npx wrangler kv namespace create LICENSES` dan salin `id`-nya ke `wrangler.toml`.
   Periksa juga `ALLOWED_ORIGINS` (alamat GitHub Pages kamu).
3. Buat kunci: `node tools/generate-keys.mjs`, lalu jalankan dua langkah yang dicetaknya
   (secret ke Worker, dan kunci publik ke `licensePublicKey` di `app.js`).
4. Kode lisensi:
   - Kode yang **sudah terjual**: tulis satu per baris di `kode-lama.txt`, lalu `node tools/codes.mjs import kode-lama.txt 2`.
   - Kode baru: `node tools/codes.mjs generate 50 ZB-PRO 2`.
   - Unggah: `npx wrangler kv bulk put kv-bulk.json --binding LICENSES --remote`.
5. (Opsional) Admin: `npx wrangler secret put ADMIN_TOKEN` (pakai teks acak panjang).
6. Deploy: `npx wrangler deploy`. Catat URL-nya (`https://zenbeat-license-v2.<akun>.workers.dev`).
7. Di `app.js` isi `licenseApiUrl` dengan URL itu dan `licensePublicKey` dengan kunci publik, lalu commit.
   Jika Worker memakai domain sendiri (bukan `*.workers.dev`), tambahkan domain itu ke `connect-src` pada tag
   `Content-Security-Policy` di `index.html`.

Worker ini sengaja bernama `zenbeat-license-v2` agar **tidak menimpa** Worker lama. Aplikasi yang masih tersimpan di
HP pengguna (versi lama) tetap memakai Worker lama sampai mereka memperbarui.
Pengguna Pro lama dimigrasi otomatis: aplikasi mengirim ulang kode yang pernah disimpannya ke server baru, jadi pastikan
semua kode yang sudah terjual ada di langkah 4.

## Operasi harian
Ganti `URL` dan `ADMIN_TOKEN` sesuai milikmu.

- Cabut kode: `curl -X POST URL -H "Content-Type: application/json" -d '{"action":"admin_revoke","adminToken":"ADMIN_TOKEN","licenseCode":"KODE"}'`
- Pulihkan: tambahkan `"revoked":false`.
- Pembeli ganti HP (kosongkan daftar perangkat): `{"action":"admin_reset","adminToken":"ADMIN_TOKEN","licenseCode":"KODE"}`
- Lihat satu kode: `npx wrangler kv key get "$(node tools/codes.mjs hash KODE)" --binding LICENSES --remote`

## Jangan pernah di-commit ke repo publik
`private-key.jwk.json`, `codes-plain.txt`, `kv-bulk.json` (sudah ada di `.gitignore`). Sebaiknya simpan seluruh folder
`license-server/` di luar repo publik game.
