// Exchange a short-lived Instagram Login token for a long-lived (60-day) token.
//
// Usage:
//   node scripts/get-long-token.js exchange   # short -> long (first time)
//   node scripts/get-long-token.js refresh    # extend existing long token
//
// Reads from .env:
//   INSTAGRAM_APP_SECRET     (only needed for "exchange")
//   IG_ACCESS_TOKEN_SHORT    (only needed for "exchange")
//   IG_ACCESS_TOKEN          (only needed for "refresh")
//
// Writes the result back into .env as IG_ACCESS_TOKEN.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '..', '.env');

function updateEnv(key, value) {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const lines = raw.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, out.filter((l, i, a) => !(l === '' && i === a.length - 1)).join('\n') + '\n', 'utf8');
}

async function exchange() {
  const { INSTAGRAM_APP_SECRET, IG_ACCESS_TOKEN_SHORT } = process.env;
  if (!IG_ACCESS_TOKEN_SHORT) {
    console.error('✗ IG_ACCESS_TOKEN_SHORT vazio no .env');
    process.exit(1);
  }

  // Try ig_exchange_token first (for tokens from OAuth web flow).
  if (INSTAGRAM_APP_SECRET) {
    try {
      console.log('▶ Tentando trocar via ig_exchange_token...');
      const { data } = await axios.get('https://graph.instagram.com/access_token', {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: INSTAGRAM_APP_SECRET,
          access_token: IG_ACCESS_TOKEN_SHORT,
        },
      });
      const daysLeft = Math.floor(data.expires_in / 86400);
      console.log(`✓ Long-lived token obtido — válido por ${daysLeft} dias`);
      updateEnv('IG_ACCESS_TOKEN', data.access_token);
      console.log('✓ Salvo em .env como IG_ACCESS_TOKEN');
      return;
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (code !== 452) throw err;
      console.log('• Exchange falhou (452) — token provavelmente já é long-lived (API Setup gera direto).');
    }
  }

  // Fallback: API Setup "Gerar token" already returns long-lived (60d). Promote it.
  console.log('▶ Promovendo token atual como long-lived (sem chamar exchange)...');
  console.log('  Validando contra /me primeiro...');
  const { data: me } = await axios.get('https://graph.instagram.com/me', {
    params: { fields: 'id,username', access_token: IG_ACCESS_TOKEN_SHORT },
  });
  console.log(`  ✓ Conta confirmada: @${me.username} (${me.id})`);
  updateEnv('IG_ACCESS_TOKEN', IG_ACCESS_TOKEN_SHORT);
  console.log('✓ Salvo em .env como IG_ACCESS_TOKEN');
  console.log('• Esse token expira em ~60 dias. Rode `npm run token:refresh` antes disso pra estender.');
}

async function refresh() {
  const { IG_ACCESS_TOKEN } = process.env;
  if (!IG_ACCESS_TOKEN) {
    console.error('✗ IG_ACCESS_TOKEN ausente no .env');
    process.exit(1);
  }

  console.log('▶ Renovando long-lived token (estende +60 dias)...');
  const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: IG_ACCESS_TOKEN,
    },
  });

  const daysLeft = Math.floor(data.expires_in / 86400);
  console.log(`✓ Token renovado — válido por ${daysLeft} dias`);
  updateEnv('IG_ACCESS_TOKEN', data.access_token);
  console.log('✓ Salvo em .env');
}

const cmd = process.argv[2];
if (cmd === 'exchange') exchange().catch(handle);
else if (cmd === 'refresh') refresh().catch(handle);
else {
  console.error('Uso: node scripts/get-long-token.js [exchange|refresh]');
  process.exit(1);
}

function handle(err) {
  console.error('✗ Falhou:', err.response?.data || err.message);
  process.exit(1);
}
