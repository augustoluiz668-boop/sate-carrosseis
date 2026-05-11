// Quick health check — pings /me with the short or long token.
//
// Usage:
//   node scripts/test-token.js short   # tests IG_ACCESS_TOKEN_SHORT
//   node scripts/test-token.js long    # tests IG_ACCESS_TOKEN

import axios from 'axios';
import 'dotenv/config';

const which = process.argv[2] || 'short';
const token = which === 'long' ? process.env.IG_ACCESS_TOKEN : process.env.IG_ACCESS_TOKEN_SHORT;

if (!token) {
  console.error(`✗ Token vazio (${which === 'long' ? 'IG_ACCESS_TOKEN' : 'IG_ACCESS_TOKEN_SHORT'})`);
  process.exit(1);
}

console.log(`▶ Testando token (${which}) — primeiros 25 chars: ${token.slice(0, 25)}...`);
console.log(`▶ Tamanho do token: ${token.length} caracteres`);

try {
  const { data } = await axios.get('https://graph.instagram.com/me', {
    params: { fields: 'id,username,account_type', access_token: token },
  });
  console.log('✓ Token VÁLIDO');
  console.log('  Conta:', data);
} catch (err) {
  console.error('✗ Token INVÁLIDO ou expirado:');
  console.error('  ', err.response?.data?.error?.message || err.message);
  process.exit(1);
}
