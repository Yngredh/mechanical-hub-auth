import type { Telemetry } from '../../core/ports/telemetry.js';

/**
 * Nomes das metricas — contrato com o repositorio mechanical-hub-infra.
 *
 * Os paineis e as regras de alerta referenciam estas series pelo nome exato.
 * Renomear qualquer uma nao quebra compilacao, nao gera erro de deploy e nao
 * aparece em log nenhum: o painel apenas fica vazio. Dai as constantes, e dai o
 * teste de contrato que as compara com o que o Grafana espera.
 *
 * O sufixo `_total` NAO aparece aqui de proposito. Quem o acrescenta e o
 * exportador prometheusremotewrite do coletor, que adiciona o sufixo a todo
 * contador monotonico (`add_metric_suffixes`). Publicar ja com `_total`
 * produziria `mechanical_hub_auth_login_total_total` no Prometheus.
 */
export const LOGIN_METRIC = 'mechanical_hub_auth_login';
export const AUTHORIZER_METRIC = 'mechanical_hub_auth_authorizer';

/** Como a serie aparece no Prometheus, depois do sufixo do coletor. */
export const LOGIN_METRIC_IN_PROMETHEUS = `${LOGIN_METRIC}_total`;
export const AUTHORIZER_METRIC_IN_PROMETHEUS = `${AUTHORIZER_METRIC}_total`;

export type LoginResult = 'success' | 'failed' | 'blocked' | 'error';
export type AuthorizerDecision = 'allow' | 'allow_anonymous' | 'deny' | 'error';

/**
 * Traduz o codigo de erro do dominio para o rotulo da metrica.
 *
 * A granularidade fica no log (que carrega o `reason` exato); a metrica agrupa
 * em poucos valores de proposito. Uma etiqueta por codigo de erro multiplicaria
 * as series sem responder nenhuma pergunta que o painel faca.
 */
export function loginResultFromErrorCode(code: string | undefined): LoginResult {
  if (code === undefined) return 'success';
  if (code === 'TOO_MANY_ATTEMPTS') return 'blocked';
  if (code === 'INTERNAL_ERROR') return 'error';
  return 'failed';
}

export function countLogin(telemetry: Telemetry, result: LoginResult): void {
  telemetry.increment(LOGIN_METRIC, { result });
}

export function countAuthorizerDecision(telemetry: Telemetry, decision: AuthorizerDecision): void {
  telemetry.increment(AUTHORIZER_METRIC, { decision });
}
