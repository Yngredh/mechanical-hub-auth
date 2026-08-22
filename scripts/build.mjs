import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';

// Cada entrypoint vira um bundle independente. O bundling mantem o artefato
// pequeno, o que reduz cold start -- ponto critico para funcoes que rodam
// dentro da VPC.
const FUNCTIONS = [
  { name: 'authenticate', entry: 'src/entrypoints/aws-lambda/authenticate.handler.ts' },
  { name: 'authorize', entry: 'src/entrypoints/aws-lambda/authorize.handler.ts' },
];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

for (const fn of FUNCTIONS) {
  await build({
    entryPoints: [fn.entry],
    outfile: `dist/${fn.name}/index.mjs`,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    minify: true,
    // O SDK da AWS ja vem no runtime; empacota-lo so aumentaria o cold start.
    external: ['@aws-sdk/*'],
    banner: {
      // pg e bcryptjs ainda usam require() internamente; o shim abaixo permite
      // que o bundle ESM os carregue sem erro.
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        'const require = __createRequire(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'info',
  });
}

console.log(`\nBuild concluido: ${FUNCTIONS.map((f) => f.name).join(', ')}`);
