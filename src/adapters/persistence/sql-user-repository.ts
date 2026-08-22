import type { Pool, QueryResultRow } from 'pg';
import { isRole } from '../../core/domain/role.js';
import type { AuthenticatableUser } from '../../core/domain/user.js';
import type { UserRepository } from '../../core/ports/user-repository.js';

/**
 * Consulta unica do login (§3 da spec).
 *
 * deleted_at NAO entra no WHERE de proposito: trazendo a linha mesmo do
 * funcionario desativado, o caso de uso consegue distinguir "nao existe" (401)
 * de "existe mas foi desligado" (403).
 */
const FIND_BY_DOCUMENT_NUMBER = `
  SELECT u.id,
         u.name,
         u.document_number,
         u.password_hash,
         u.deleted_at,
         p.name AS profile
    FROM users u
    JOIN profiles p ON p.id = u.profile_id
   WHERE u.document_number = $1
   LIMIT 1
`;

interface UserRow extends QueryResultRow {
  id: string;
  name: string | null;
  document_number: string;
  password_hash: string;
  deleted_at: Date | null;
  profile: string;
}

export class SqlUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByDocumentNumber(documentNumber: string): Promise<AuthenticatableUser | null> {
    const result = await this.pool.query<UserRow>(FIND_BY_DOCUMENT_NUMBER, [documentNumber]);
    const row = result.rows[0];

    if (row === undefined) return null;

    // Perfil desconhecido e inconsistencia de dados, nao credencial invalida.
    // Falhar alto aqui evita emitir token com role que ninguem sabe interpretar.
    if (!isRole(row.profile)) {
      throw new Error(`Perfil desconhecido para o usuario ${row.id}: ${row.profile}`);
    }

    return {
      id: row.id,
      name: row.name ?? '',
      documentNumber: row.document_number,
      passwordHash: row.password_hash,
      role: row.profile,
      deletedAt: row.deleted_at,
    };
  }
}
