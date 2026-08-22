import type { AuthenticatableUser } from '../domain/user.js';

/**
 * Leitura de funcionarios. Somente leitura por design: a funcao de
 * autenticacao nunca escreve no banco de dominio (a role de banco tambem nao
 * tem permissao para isso).
 */
export interface UserRepository {
  /**
   * Busca por documento normalizado. Retorna o usuario mesmo se estiver
   * inativo -- quem decide o que fazer com isso e o caso de uso, porque
   * "nao existe" e "existe mas desativado" tem respostas HTTP diferentes.
   */
  findByDocumentNumber(documentNumber: string): Promise<AuthenticatableUser | null>;
}
