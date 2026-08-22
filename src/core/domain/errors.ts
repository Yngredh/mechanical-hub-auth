/**
 * Erros de negocio da autenticacao.
 *
 * Carregam o codigo e o status HTTP porque a fronteira de transporte (§4.1 da
 * spec) e parte do contrato publico. Nenhum erro daqui expoe detalhe interno:
 * a mensagem que chega ao cliente e sempre generica.
 */

export type AuthErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_CPF'
  | 'INVALID_CREDENTIALS'
  | 'USER_INACTIVE'
  | 'TOO_MANY_ATTEMPTS'
  | 'INTERNAL_ERROR';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }

  static invalidRequest(detail = 'Requisicao invalida'): AuthError {
    return new AuthError('INVALID_REQUEST', 400, detail);
  }

  static invalidDocumentNumber(): AuthError {
    return new AuthError('INVALID_CPF', 400, 'CPF invalido');
  }

  /**
   * Usado tanto para documento inexistente quanto para senha errada.
   * Resposta identica nos dois casos, para nao permitir enumeracao de usuarios.
   */
  static invalidCredentials(): AuthError {
    return new AuthError('INVALID_CREDENTIALS', 401, 'CPF ou senha invalidos');
  }

  static userInactive(): AuthError {
    return new AuthError('USER_INACTIVE', 403, 'Usuario inativo');
  }

  static tooManyAttempts(): AuthError {
    return new AuthError('TOO_MANY_ATTEMPTS', 429, 'Tentativas excedidas. Tente novamente mais tarde');
  }

  static internal(): AuthError {
    return new AuthError('INTERNAL_ERROR', 500, 'Erro interno');
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
