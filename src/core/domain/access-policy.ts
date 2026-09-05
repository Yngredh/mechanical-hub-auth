import type { Role } from './role.js';

/**
 * Matriz de autorizacao rota x perfil.
 *
 * Espelha a SecurityConfiguration da aplicacao principal. Fica em codigo, e
 * nao em configuracao de nuvem, justamente para ser testavel e portavel: a
 * mesma matriz vale independente de quem chama (API Gateway, Azure APIM,
 * um proxy proprio).
 *
 * A avaliacao e por primeira regra que casa -- por isso a ordem importa e as
 * rotas mais especificas vem antes.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const PUBLIC = 'PUBLIC' as const;

export interface AccessRule {
  readonly path: string;
  readonly methods: '*' | readonly HttpMethod[];
  readonly allow: typeof PUBLIC | readonly Role[];
  readonly description: string;
}

export const ACCESS_RULES: readonly AccessRule[] = [
  // --- Publicas ------------------------------------------------------------
  {
    path: '/auth/login',
    methods: ['POST'],
    allow: PUBLIC,
    description: 'Emissao de token',
  },
  {
    path: '/actuator/health/**',
    methods: ['GET'],
    allow: PUBLIC,
    description: 'Healthcheck',
  },
  {
    path: '/actuator/health',
    methods: ['GET'],
    allow: PUBLIC,
    description: 'Healthcheck',
  },
  {
    path: '/swagger-ui/**',
    methods: ['GET'],
    allow: PUBLIC,
    description: 'Documentacao',
  },
  {
    path: '/v3/api-docs/**',
    methods: ['GET'],
    allow: PUBLIC,
    description: 'Documentacao',
  },
  {
    // Rotas do cliente final: consulta da OS por numero, aprovacao e rejeicao
    // de orcamento. O cliente nunca autentica (ADR-0001).
    path: '/mechanical-hub/service-orders/**',
    methods: '*',
    allow: PUBLIC,
    description: 'Rotas do cliente final',
  },

  // --- Exclusivas do administrador ----------------------------------------
  // O cadastro de funcionario e POST /users/register na aplicacao, ja coberto por
  // /users/** — nao existe /auth/register.
  { path: '/users/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Gestao de funcionarios' },
  { path: '/users', methods: '*', allow: ['ADMINISTRATOR'], description: 'Gestao de funcionarios' },
  { path: '/customers/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Clientes' },
  { path: '/vehicles/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Veiculos' },
  { path: '/services/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Servicos' },
  { path: '/materials/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Materiais' },
  { path: '/stock/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Estoque' },
  { path: '/reports/**', methods: '*', allow: ['ADMINISTRATOR'], description: 'Relatorios' },

  // --- Mecanico e administrador -------------------------------------------
  {
    path: '/service-orders/**',
    methods: '*',
    allow: ['MECHANICAL', 'ADMINISTRATOR'],
    description: 'Ordens de servico',
  },
  {
    path: '/service-orders',
    methods: '*',
    allow: ['MECHANICAL', 'ADMINISTRATOR'],
    description: 'Ordens de servico',
  },
];

export type AccessDecision =
  | { readonly kind: 'PUBLIC'; readonly rule: AccessRule }
  | { readonly kind: 'REQUIRES_ROLE'; readonly rule: AccessRule; readonly roles: readonly Role[] }
  | { readonly kind: 'UNKNOWN_ROUTE' };

/**
 * Descobre o que a rota exige. Rota nao mapeada cai em UNKNOWN_ROUTE, que o
 * caso de uso trata como negacao -- default deny, nunca default allow.
 */
export function resolveAccess(
  path: string,
  method: string,
  rules: readonly AccessRule[] = ACCESS_RULES,
): AccessDecision {
  const normalizedPath = normalizePath(path);
  const normalizedMethod = method.toUpperCase();

  for (const rule of rules) {
    if (!matchesMethod(rule, normalizedMethod)) continue;
    if (!matchesPath(rule.path, normalizedPath)) continue;

    return rule.allow === PUBLIC
      ? { kind: 'PUBLIC', rule }
      : { kind: 'REQUIRES_ROLE', rule, roles: rule.allow };
  }

  return { kind: 'UNKNOWN_ROUTE' };
}

export function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? '';
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  // Remove barra final, exceto na raiz.
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;
}

function matchesMethod(rule: AccessRule, method: string): boolean {
  return rule.methods === '*' || (rule.methods as readonly string[]).includes(method);
}

function matchesPath(pattern: string, path: string): boolean {
  const patternSegments = normalizePath(pattern).split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);

  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i];

    if (patternSegment === '**') return true;

    const pathSegment = pathSegments[i];
    if (pathSegment === undefined) return false;
    if (patternSegment === '*') continue;
    if (patternSegment !== pathSegment) return false;
  }

  return patternSegments.length === pathSegments.length;
}
