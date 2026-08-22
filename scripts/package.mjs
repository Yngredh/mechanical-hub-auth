import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Gera um zip por funcao em build/. Usa o `zip` do sistema quando disponivel
// (Linux/macOS/CI) e cai para PowerShell no Windows.
const FUNCTIONS = ['authenticate', 'authorize'];
const OUT_DIR = resolve('build');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const isWindows = process.platform === 'win32';

for (const name of FUNCTIONS) {
  const source = resolve('dist', name);
  const target = resolve(OUT_DIR, `${name}.zip`);

  if (!existsSync(source)) {
    throw new Error(`Bundle nao encontrado: ${source}. Rode "npm run build" antes.`);
  }

  if (isWindows) {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${source}\\*' -DestinationPath '${target}' -Force`,
    ], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', '-q', target, '.'], { cwd: source, stdio: 'inherit' });
  }

  console.log(`empacotado: build/${name}.zip`);
}
