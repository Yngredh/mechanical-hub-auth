import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { BcryptPasswordVerifier } from '../../src/adapters/security/bcrypt-password-verifier.js';

/**
 * Teste de compatibilidade critico (§12 da spec).
 *
 * As senhas ja cadastradas foram geradas pelo BCryptPasswordEncoder do Spring,
 * que emite hashes com prefixo $2a$. Se o bcryptjs deixar de ler esse formato,
 * ninguem consegue mais logar -- e o sintoma seria "senha invalida", nao um
 * erro de deploy. Por isso os vetores abaixo sao fixos e vem do conjunto de
 * testes do jBCrypt, a mesma implementacao de referencia do lado Java.
 */
const JAVA_VECTORS: ReadonlyArray<readonly [password: string, hash: string]> = [
  ['', '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.'],
  ['a', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
  ['abc', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
  [
    'abcdefghijklmnopqrstuvwxyz',
    '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC',
  ],
];

const verifier = new BcryptPasswordVerifier();

describe('BcryptPasswordVerifier — compatibilidade com o hash do Spring', () => {
  it.each(JAVA_VECTORS)('valida hash $2a$ gerado no Java para "%s"', async (password, hash) => {
    expect(await verifier.verify(password, hash)).toBe(true);
  });

  it('recusa senha errada contra hash $2a$ do Java', async () => {
    const [, hash] = JAVA_VECTORS[2]!;
    expect(await verifier.verify('outra-senha', hash)).toBe(false);
  });

  it('valida hash com custo 10, o mesmo usado pelo seed da aplicacao', async () => {
    const hash = bcrypt.hashSync('senha-do-mecanico', bcrypt.genSaltSync(10));

    expect(hash.startsWith('$2')).toBe(true);
    expect(await verifier.verify('senha-do-mecanico', hash)).toBe(true);
  });
});

describe('BcryptPasswordVerifier — robustez', () => {
  it.each(['', 'nao-e-um-hash', '$2a$10$curto'])(
    'trata hash invalido (%s) como credencial invalida, sem lancar',
    async (hash) => {
      await expect(verifier.verify('qualquer', hash)).resolves.toBe(false);
    },
  );

  it('consumeTime executa uma comparacao real', async () => {
    const startedAt = process.hrtime.bigint();
    await verifier.consumeTime();
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // Custo 10 nunca resolve instantaneamente; o objetivo e garantir que o
    // caminho "usuario nao existe" nao seja mensuravelmente mais rapido.
    expect(elapsedMs).toBeGreaterThan(1);
  });
});
