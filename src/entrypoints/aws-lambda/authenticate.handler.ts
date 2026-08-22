import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getAuthenticationContainer } from '../../composition/container.js';
import { handleAuthenticate } from '../http/authenticate-controller.js';
import { toHttpRequest, toProxyResult } from './event-mapper.js';

// Resolvido no escopo do modulo: roda uma vez por instancia, nao por invocacao.
const container = getAuthenticationContainer();

/**
 * Adaptador de entrada da funcao de login. Toda a logica esta em
 * handleAuthenticate / authenticateUser; aqui so acontece traducao de formato.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const response = await handleAuthenticate(toHttpRequest(event), container);
  return toProxyResult(response);
}

export default handler;
