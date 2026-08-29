import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthenticationContainer } from '../../composition/container.js';
import { parseTraceParent } from '../../adapters/observability/trace-context.js';
import { handleAuthenticate } from '../http/authenticate-controller.js';
import { readHeader } from '../http/http-contract.js';
import { toHttpRequest, toProxyResult } from './event-mapper.js';

// Resolvido no escopo do modulo: roda uma vez por instancia, nao por invocacao.
const container = getAuthenticationContainer();

/**
 * Adaptador de entrada da funcao de login. Toda a logica esta em
 * handleAuthenticate / authenticateUser; aqui so acontece traducao de formato
 * e o ciclo de vida do rastro.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const request = toHttpRequest(event);

  // Continua o rastro do chamador quando houver `traceparent`; senao comeca um.
  // Na pratica o API Gateway REST v1 nao propaga esse cabecalho, entao o rastro
  // costuma nascer aqui — o cabecalho e lido mesmo assim porque um cliente pode
  // envia-lo, e ai o login aparece dentro do rastro dele.
  const parent = parseTraceParent(readHeader(request.headers, 'traceparent')) ?? undefined;
  const span = container.telemetry.startSpan(
    { name: 'POST /auth/login', attributes: { 'http.method': 'POST', 'http.route': '/auth/login' } },
    parent,
  );

  try {
    const response = await handleAuthenticate(request, container, span.context);

    span.end({
      attributes: { 'http.status_code': String(response.status) },
      // 4xx aqui e credencial errada, nao defeito: marcar como erro encheria o
      // Tempo de spans vermelhos numa operacao que esta funcionando. So 5xx
      // vira falha.
      ...(response.status >= 500 ? { error: `HTTP ${response.status}` } : {}),
    });

    return toProxyResult(response);
  } catch (error) {
    span.end({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    // Obrigatorio, e obrigatoriamente aqui: a Lambda congela a execucao assim
    // que a resposta sai. Um envio pendente so seria retomado na proxima
    // invocacao — ou perdido, se a instancia for reciclada antes.
    await container.telemetry.flush();
  }
}

export default handler;
