// Ключи для пушей выводятся из одного секрета (CLOUDFLARE_API_TOKEN): человеку не надо заводить и хранить их отдельно.
// Один и тот же секрет даёт одни и те же ключи при выкладке Worker и при рассылке.
// Если секрет сменить, ключи сменятся: приложение само переподпишется при следующем открытии.
// Запуск: node scripts/push_keys.mjs public|admin   (секрет берётся из переменной CLOUDFLARE_API_TOKEN)
import { createHmac, createECDH } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// порядок группы P-256: закрытый ключ обязан быть в диапазоне (0, N)
const N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function deriveVapid(secret) {
  if (typeof secret !== 'string' || secret.length < 20) throw new Error('секрет слишком короткий');
  for (let i = 0; i < 100; i++) {
    const d = createHmac('sha256', secret).update('uzlades-vapid-v1:' + i).digest();
    const n = BigInt('0x' + d.toString('hex'));
    if (n > 0n && n < N) {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(d);
      return { privateKey: b64url(d), publicKey: b64url(ecdh.getPublicKey()) };
    }
  }
  throw new Error('не удалось получить ключ');
}

export function deriveAdminToken(secret) {
  if (typeof secret !== 'string' || secret.length < 20) throw new Error('секрет слишком короткий');
  return createHmac('sha256', secret).update('uzlades-admin-v1').digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const what = process.argv[2];
  const secret = process.env.CLOUDFLARE_API_TOKEN;
  try {
    if (what === 'public') process.stdout.write(deriveVapid(secret).publicKey);
    else if (what === 'admin') process.stdout.write(deriveAdminToken(secret));
    else { console.error('usage: push_keys.mjs public|admin'); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
