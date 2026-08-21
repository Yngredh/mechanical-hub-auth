/**
 * Perfis de acesso.
 *
 * Os valores sao os de profiles.name no banco (MECHANICAL / ADMINISTRATOR) --
 * essa e a unica fonte de verdade. O ProfileEnum.displayName da aplicacao
 * principal (MECANICO / ADMIN) nao e usado como identificador de perfil.
 */

export const ROLES = ['MECHANICAL', 'ADMINISTRATOR'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
