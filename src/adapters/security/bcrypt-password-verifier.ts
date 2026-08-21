import bcrypt from 'bcryptjs';
import type { PasswordVerifier } from '../../core/ports/password-verifier.js';

/**
 * Hash gerado pelo BCryptPasswordEncoder do Spring, prefixo $2a$ custo 10.
 * O bcryptjs le esse formato -- e o teste de compatibilidade em
 * tests/unit/bcrypt-password-verifier.test.ts trava esse contrato.
 */
const DUMMY_HASH = '$2a$10$X9/XYPVGcZt6C0zRm9ncSumgLtJ2fb1QDHFcZnh0xVfNfuOEo7HI6';
const DUMMY_PASSWORD = 'timing-attack-mitigation';

export class BcryptPasswordVerifier implements PasswordVerifier {
  async verify(plainPassword: string, storedHash: string): Promise<boolean> {
    if (!storedHash) return false;

    try {
      return await bcrypt.compare(plainPassword, storedHash);
    } catch {
      // Hash corrompido ou em formato desconhecido nao deve virar 500 --
      // do ponto de vista do chamador e apenas credencial invalida.
      return false;
    }
  }

  async consumeTime(): Promise<void> {
    await bcrypt.compare(DUMMY_PASSWORD, DUMMY_HASH);
  }
}
