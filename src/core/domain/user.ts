import type { Role } from './role.js';

/**
 * Visao minima do funcionario, do jeito que a autenticacao precisa.
 * Deliberadamente nao e a entidade completa da aplicacao principal: aqui so
 * entram os campos do contrato de banco descrito na §10 da spec.
 */
export interface AuthenticatableUser {
  readonly id: string;
  readonly name: string;
  readonly documentNumber: string;
  readonly passwordHash: string;
  readonly role: Role;
  /** Soft delete. Preenchido = funcionario desativado. Unica fonte de verdade sobre atividade. */
  readonly deletedAt: Date | null;
}

export function isActive(user: AuthenticatableUser): boolean {
  return user.deletedAt === null;
}
