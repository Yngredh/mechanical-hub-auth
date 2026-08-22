/**
 * Contencao de forca bruta.
 *
 * Abstraido porque o armazenamento muda conforme o ambiente: em memoria no
 * teste e no lab (por instancia), tabela distribuida em producao. O core so
 * pergunta "pode tentar?" e reporta o resultado.
 */
export interface AttemptLimiter {
  isBlocked(key: string): Promise<boolean>;
  registerFailure(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

/** Implementacao neutra para quando o recurso de armazenamento nao existe. */
export const NOOP_ATTEMPT_LIMITER: AttemptLimiter = {
  async isBlocked() {
    return false;
  },
  async registerFailure() {
    /* sem efeito */
  },
  async reset() {
    /* sem efeito */
  },
};
