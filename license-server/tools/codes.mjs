// Membuat / mengimpor kode lisensi ke Cloudflare KV.
//   node tools/codes.mjs generate 50 ZB-PRO 2      -> 50 kode baru, prefiks ZB-PRO, maks 2 perangkat/kode
//   node tools/codes.mjs import kode-lama.txt 2    -> impor kode yang sudah terjual (satu kode per baris)
//   node tools/codes.mjs hash ZB-PRO-AB12CD        -> tampilkan kunci KV sebuah kode
// Hasil: codes-plain.txt (daftar kode asli, RAHASIA) dan kv-bulk.json (hanya HASH kode, untuk diunggah ke KV):
//   npx wrangler kv bulk put kv-bulk.json --binding LICENSES --remote
import { webcrypto as crypto, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa karakter mirip (0/O, 1/I)
const rand = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

const [cmd, a, b, c] = process.argv.slice(2);
let codes = [];
let maxDevices = 2;

if (cmd === 'generate') {
  const count = Number(a || 10);
  const prefix = (b || 'ZB-PRO').toUpperCase();
  maxDevices = Number(c || 2);
  codes = Array.from({ length: count }, () => `${prefix}-${rand(4)}-${rand(4)}-${rand(4)}`);
} else if (cmd === 'import') {
  maxDevices = Number(b || 2);
  codes = readFileSync(a, 'utf8').split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter(Boolean);
} else if (cmd === 'hash') {
  console.log('code:' + (await sha(String(a).trim().toUpperCase())));
  process.exit(0);
} else {
  console.log('Perintah: generate <jumlah> <prefiks> <maksPerangkat> | import <file> <maksPerangkat> | hash <kode>');
  process.exit(1);
}

const bulk = [];
for (const code of codes) {
  bulk.push({ key: 'code:' + (await sha(code)), value: JSON.stringify({ maxDevices, devices: [] }) });
}
writeFileSync('kv-bulk.json', JSON.stringify(bulk));
writeFileSync('codes-plain.txt', codes.join('\n') + '\n');
console.log(`${codes.length} kode siap. Unggah: npx wrangler kv bulk put kv-bulk.json --binding LICENSES --remote`);
console.log('Daftar kode asli ada di codes-plain.txt (simpan aman, jangan di-commit).');
