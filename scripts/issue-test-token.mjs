import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

// Emite um token igual ao que a funcao "authenticate" geraria, sem precisar
// de login nem de banco. Serve para testar a funcao "authorize" (ou uma rota
// protegida ja implantada) isoladamente.
//
// Uso:
//   TOKEN_SIGNING_KEY='chave-com-32-caracteres-no-minimo' node scripts/issue-test-token.mjs ADMINISTRATOR
//   TOKEN_SIGNING_KEY='...' node scripts/issue-test-token.mjs MECHANICAL

const role = process.argv[2] ?? 'ADMINISTRATOR';

if (!['ADMINISTRATOR', 'MECHANICAL'].includes(role)) {
  console.error('Perfil invalido. Use ADMINISTRATOR ou MECHANICAL.');
  process.exit(1);
}

const secret = process.env.TOKEN_SIGNING_KEY;
if (!secret) {
  console.error('Defina TOKEN_SIGNING_KEY no ambiente (mesma chave configurada na funcao) antes de rodar.');
  process.exit(1);
}

const token = jwt.sign(
  { cpf: '52998224725', name: 'Usuario de Teste', role },
  secret,
  {
    algorithm: 'HS256',
    issuer: process.env.TOKEN_ISSUER ?? 'mechanical-hub-auth',
    audience: process.env.TOKEN_AUDIENCE ?? 'mechanical-hub-api',
    subject: randomUUID(),
    expiresIn: Number(process.env.TOKEN_TTL_SECONDS ?? 7200),
    jwtid: randomUUID(),
  },
);

console.log(token);
