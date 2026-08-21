/**
 * Contrato HTTP neutro.
 *
 * Os controladores falam esta linguagem, nao a do provedor. Trocar API Gateway
 * por Azure Functions, Cloud Functions ou um servidor Node so exige um novo
 * mapeador de evento -> HttpRequest.
 */

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string | null;
  readonly sourceIp?: string;
  readonly correlationId?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export function jsonResponse(status: number, payload: unknown): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/** Busca cabecalho sem depender da caixa usada pelo provedor. */
export function readHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }

  return undefined;
}
