import type { SecretProvider } from '../../core/ports/secret-provider.js';

/**
 * Segredos vindos das variaveis de ambiente da funcao.
 *
 * E a implementacao usada no AWS Academy Lab, onde o Secrets Manager nao esta
 * disponivel. Em producao basta registrar o AwsSecretsManagerSecretProvider na
 * composicao -- nada no core muda.
 *
 * Limitacao conhecida e aceita: variavel de ambiente de funcao nao rotaciona
 * sozinha e fica visivel para quem tem permissao de leitura da configuracao.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly source: NodeJS.ProcessEnv = process.env) {}

  async getSecret(reference: string): Promise<string> {
    const value = this.source[reference];

    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Segredo ausente na configuracao: ${reference}`);
    }

    return value;
  }

  async getSecretAsJson<T>(reference: string): Promise<T> {
    const raw = await this.getSecret(reference);

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Segredo ${reference} nao contem JSON valido`);
    }
  }
}
