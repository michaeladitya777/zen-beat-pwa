// Membuat pasangan kunci tanda tangan ECDSA P-256.
//   node tools/generate-keys.mjs
// - private-key.jwk.json : RAHASIA. Jangan di-commit. Pasang ke Worker sebagai secret.
// - kunci publik          : ditempel ke APP_CONFIG.licensePublicKey di app.js (aman dipublikasikan).
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';

if (existsSync('private-key.jwk.json')) {
  console.error('private-key.jwk.json sudah ada. Hapus manual jika memang ingin membuat kunci baru (token lama akan tidak berlaku).');
  process.exit(1);
}
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
writeFileSync('private-key.jwk.json', JSON.stringify(priv), { mode: 0o600 });

console.log('Kunci privat disimpan di private-key.jwk.json (RAHASIA).');
console.log('\n1) Pasang ke Worker:\n   npx wrangler secret put SIGNING_KEY_JWK < private-key.jwk.json');
console.log('\n2) Tempel di app.js (APP_CONFIG):\n   licensePublicKey: ' + JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }) + ',');
