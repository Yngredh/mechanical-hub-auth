import type { SecretProvider } from '../../core/ports/secret-provider.js';

/**
 * Segredos vindos do AWS Secrets Manager.
 */
export class AwsSecretsManagerSecretProvider implements SecretProvider {
  private client: SecretsManagerLike | null = null;

  constructor(private readonly region: string | undefined) {}

  async getSecret(reference: string): Promise<string> {
    const client = await this.getClient();
    const value = await client.resolve(reference);

    if (value === undefined) {
      throw new Error(`Segredo sem valor textual: ${reference}`);
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

  private async getClient(): Promise<SecretsManagerLike> {
    if (this.client !== null) return this.client;

    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );

    const sdkClient = new SecretsManagerClient(this.region ? { region: this.region } : {});

    this.client = {
      resolve: async (secretId: string) => {
        const response = await sdkClient.send(new GetSecretValueCommand({ SecretId: secretId }));
        return response.SecretString;
      },
    };

    return this.client;
  }
}

interface SecretsManagerLike {
  resolve(secretId: string): Promise<string | undefined>;
}
