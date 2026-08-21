import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../src/adapters/security/jwt-token-service.js';

const SIGNING_KEY = 'chave-de-teste-com-mais-de-32-caracteres!!';
const ISSUER = 'mechanical-hub-auth';
const AUDIENCE = 'mechanical-hub-api';

function service(overrides: Partial<ConstructorParameters<typeof JwtTokenService>[0]> = {}) {
  return new JwtTokenService({
    resolveSigningKey: async () => SIGNING_KEY,
    issuer: ISSUER,
    audience: AUDIENCE,
    ttlSeconds: 7200,
    ...overrides,
  });
}

const CLAIMS = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Maria Silva',
  documentNumber: '52998224725',
  role: 'ADMINISTRATOR',
} as const;

describe('JwtTokenService — emissao', () => {
  it('preenche as claims do contrato', async () => {
    const { token, expiresInSeconds } = await service().issue(CLAIMS);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(expiresInSeconds).toBe(7200);
    expect(decoded.sub).toBe(CLAIMS.userId);
    expect(decoded.iss).toBe(ISSUER);
    expect(decoded.aud).toBe(AUDIENCE);
    expect(decoded.role).toBe('ADMINISTRATOR');
    expect(decoded.cpf).toBe(CLAIMS.documentNumber);
    expect(decoded.name).toBe('Maria Silva');
    expect(decoded.jti).toEqual(expect.any(String));
    expect(Number(decoded.exp) - Number(decoded.iat)).toBe(7200);
  });

  it('nao inclui hash de senha nem campo extra sensivel', async () => {
    const { token } = await service().issue(CLAIMS);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(Object.keys(decoded).sort()).toEqual(
      ['aud', 'cpf', 'exp', 'iat', 'iss', 'jti', 'name', 'role', 'sub'].sort(),
    );
  });

  it('usa HS256', async () => {
    const { token } = await service().issue(CLAIMS);
    const header = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString());

    expect(header.alg).toBe('HS256');
  });
});

describe('JwtTokenService — verificacao', () => {
  it('aceita token que ele mesmo emitiu', async () => {
    const subject = service();
    const { token } = await subject.issue(CLAIMS);

    const result = await subject.verify(token);

    expect(result).toEqual({ valid: true, claims: CLAIMS });
  });

  it('rejeita token expirado', async () => {
    const expired = jwt.sign({ cpf: CLAIMS.documentNumber, role: CLAIMS.role }, SIGNING_KEY, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: CLAIMS.userId,
      expiresIn: -10,
    });

    expect(await service().verify(expired)).toEqual({ valid: false, reason: 'EXPIRED' });
  });

  it('rejeita assinatura feita com outra chave', async () => {
    const foreign = jwt.sign({ cpf: CLAIMS.documentNumber, role: CLAIMS.role }, 'outra-chave', {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: CLAIMS.userId,
      expiresIn: 3600,
    });

    expect((await service().verify(foreign)).valid).toBe(false);
  });

  it('rejeita token com alg none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: CLAIMS.userId, role: 'ADMINISTRATOR', cpf: CLAIMS.documentNumber, iss: ISSUER, aud: AUDIENCE }),
    ).toString('base64url');

    expect((await service().verify(`${header}.${payload}.`)).valid).toBe(false);
  });

  it('rejeita emissor diferente do esperado', async () => {
    const foreign = jwt.sign({ cpf: CLAIMS.documentNumber, role: CLAIMS.role }, SIGNING_KEY, {
      algorithm: 'HS256',
      issuer: 'outro-emissor',
      audience: AUDIENCE,
      subject: CLAIMS.userId,
      expiresIn: 3600,
    });

    expect(await service().verify(foreign)).toEqual({ valid: false, reason: 'UNTRUSTED_ISSUER' });
  });

  it('rejeita audiencia diferente da esperada', async () => {
    const foreign = jwt.sign({ cpf: CLAIMS.documentNumber, role: CLAIMS.role }, SIGNING_KEY, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: 'outra-api',
      subject: CLAIMS.userId,
      expiresIn: 3600,
    });

    expect(await service().verify(foreign)).toEqual({ valid: false, reason: 'UNTRUSTED_ISSUER' });
  });

  it('rejeita token sem claim de perfil', async () => {
    const incomplete = jwt.sign({ cpf: CLAIMS.documentNumber }, SIGNING_KEY, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: CLAIMS.userId,
      expiresIn: 3600,
    });

    expect(await service().verify(incomplete)).toEqual({ valid: false, reason: 'MISSING_CLAIMS' });
  });

  it('rejeita perfil fora do dominio conhecido', async () => {
    const unknownRole = jwt.sign({ cpf: CLAIMS.documentNumber, role: 'SUPERUSER' }, SIGNING_KEY, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: CLAIMS.userId,
      expiresIn: 3600,
    });

    expect(await service().verify(unknownRole)).toEqual({ valid: false, reason: 'MISSING_CLAIMS' });
  });

  it('rejeita texto que nao e um token', async () => {
    expect((await service().verify('nao-e-um-token')).valid).toBe(false);
  });
});
