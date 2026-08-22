/**
 * Verificacao de senha contra o hash armazenado.
 *
 * A implementacao precisa ser compativel com o algoritmo usado pela aplicacao
 * principal (BCrypt, prefixo $2a$), senao as senhas existentes deixam de
 * funcionar apos a migracao.
 */
export interface PasswordVerifier {
  verify(plainPassword: string, storedHash: string): Promise<boolean>;

  /**
   * Comparacao descartavel contra um hash fixo, usada quando o usuario nao
   * existe. Mantem o tempo de resposta parecido com o do caminho feliz e
   * impede que um atacante descubra quais documentos estao cadastrados
   * medindo latencia.
   */
  consumeTime(): Promise<void>;
}
