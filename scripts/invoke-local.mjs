import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Invoca um bundle já construído (dist/<funcao>/index.mjs) com um evento de
// exemplo, sem precisar de AWS nem de deploy. Util para depurar o mapeamento
// de evento e a logica de negocio isoladamente.
//
// Uso:
//   npm run build
//   node scripts/invoke-local.mjs authorize tests/local/events/authorizer-public-route.json
//   node scripts/invoke-local.mjs authenticate tests/local/events/login-request.json

const [, , functionName, eventPath] = process.argv;

if (!functionName || !eventPath) {
  console.error('Uso: node scripts/invoke-local.mjs <authenticate|authorize> <evento.json>');
  process.exit(1);
}

const bundlePath = `../dist/${functionName}/index.mjs`;
if (!existsSync(new URL(bundlePath, import.meta.url))) {
  console.error(`Bundle nao encontrado em dist/${functionName}/. Rode "npm run build" primeiro.`);
  process.exit(1);
}

const event = JSON.parse(await readFile(eventPath, 'utf8'));
const { handler } = await import(bundlePath);

try {
  const result = await handler(event);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // O autorizador lanca Error("Unauthorized") de proposito quando nega por
  // falta/invalidez de token -- e assim que o API Gateway sabe responder 401.
  console.error('Handler lancou uma excecao:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
