import { AuthError } from '../domain/errors.js';
import {
  isValidDocumentNumber,
  maskDocumentNumber,
  normalizeDocumentNumber,
} from '../domain/document-number.js';
import { isActive } from '../domain/user.js';
import type { AttemptLimiter } from '../ports/attempt-limiter.js';
import type { Logger } from '../ports/logger.js';
import type { PasswordVerifier } from '../ports/password-verifier.js';
import type { IssuedToken, TokenService } from '../ports/token-service.js';
import type { UserRepository } from '../ports/user-repository.js';

export interface AuthenticateUserInput {
  readonly documentNumber: string;
  readonly password: string;
}

export interface AuthenticateUserDependencies {
  readonly users: UserRepository;
  readonly passwords: PasswordVerifier;
  readonly tokens: TokenService;
  readonly limiter: AttemptLimiter;
  readonly logger: Logger;
}

/** Limite do BCrypt: senhas maiores sao truncadas silenciosamente. */
const MAX_PASSWORD_BYTES = 72;

/**
 * Login do funcionario.
 *
 * Sequencia deliberada: validacoes baratas primeiro (formato, bloqueio), banco
 * depois. Documento inexistente e senha errada produzem exatamente a mesma
 * resposta, e ambos passam pelo mesmo custo de tempo.
 */
export async function authenticateUser(
  input: AuthenticateUserInput,
  deps: AuthenticateUserDependencies,
): Promise<IssuedToken> {
  const { users, passwords, tokens, limiter, logger } = deps;

  // 1. Validacao sintatica
  if (typeof input?.documentNumber !== 'string' || typeof input?.password !== 'string') {
    throw AuthError.invalidRequest('Campos "cpf" e "password" sao obrigatorios');
  }
  if (input.password.length === 0 || Buffer.byteLength(input.password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw AuthError.invalidRequest('Senha com tamanho invalido');
  }

  // 2 e 3. Normalizacao e validacao do documento -- evita ida ao banco
  if (!isValidDocumentNumber(input.documentNumber)) {
    logger.warn('login.failed', { reason: 'INVALID_CPF' });
    throw AuthError.invalidDocumentNumber();
  }

  const documentNumber = normalizeDocumentNumber(input.documentNumber);
  const maskedDocument = maskDocumentNumber(documentNumber);
  const scopedLogger = logger.withContext({ cpfMasked: maskedDocument });

  // 4. Bloqueio por tentativas
  if (await limiter.isBlocked(documentNumber)) {
    scopedLogger.warn('login.blocked', { reason: 'TOO_MANY_ATTEMPTS' });
    throw AuthError.tooManyAttempts();
  }

  scopedLogger.info('login.attempt');

  // 6. Consulta
  const user = await users.findByDocumentNumber(documentNumber);

  // 7. Nao encontrado: gasta o mesmo tempo de um bcrypt real antes de responder
  if (user === null) {
    await passwords.consumeTime();
    await limiter.registerFailure(documentNumber);
    scopedLogger.warn('login.failed', { reason: 'INVALID_CREDENTIALS' });
    throw AuthError.invalidCredentials();
  }

  // 8. Senha
  const passwordMatches = await passwords.verify(input.password, user.passwordHash);
  if (!passwordMatches) {
    await limiter.registerFailure(documentNumber);
    scopedLogger.warn('login.failed', { reason: 'INVALID_CREDENTIALS' });
    throw AuthError.invalidCredentials();
  }

  // 9. Funcionario desativado (soft delete)
  if (!isActive(user)) {
    scopedLogger.warn('login.failed', { reason: 'USER_INACTIVE', userId: user.id });
    throw AuthError.userInactive();
  }

  // 10. Emissao
  const issued = await tokens.issue({
    userId: user.id,
    name: user.name,
    documentNumber: user.documentNumber,
    role: user.role,
  });

  // 11. Sucesso
  await limiter.reset(documentNumber);
  scopedLogger.info('login.success', { userId: user.id, role: user.role });

  return issued;
}
