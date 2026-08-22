import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        // Interfaces puras: nao geram codigo executavel.
        'src/core/ports/**',
        // Handlers e raiz de composicao: adaptadores finos, validados no teste
        // de integracao e no smoke test pos-deploy.
        'src/entrypoints/aws-lambda/*.handler.ts',
        'src/composition/**',
        // Dependem de recursos externos (banco, cofre gerenciado).
        'src/adapters/persistence/**',
        'src/adapters/secrets/aws-secrets-manager-secret-provider.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
