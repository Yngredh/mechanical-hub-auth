/**
 * Fonte de segredos.
 *
 * Existe para que o core nao saiba se o segredo veio de variavel de ambiente,
 * de um cofre gerenciado ou de um arquivo montado. Trocar de nuvem, ou sair do
 * AWS Academy Lab (onde o Secrets Manager nao esta disponivel) para producao,
 * e trocar a implementacao registrada na composicao.
 */
export interface SecretProvider {
  /** Segredo textual simples (ex.: chave de assinatura do token). */
  getSecret(reference: string): Promise<string>;

  /** Segredo estruturado (ex.: credenciais de banco). */
  getSecretAsJson<T>(reference: string): Promise<T>;
}

export interface DatabaseCredentials {
  readonly username: string;
  readonly password: string;
}
