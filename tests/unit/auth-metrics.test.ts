import { describe, expect, it } from 'vitest';
import {
  AUTHORIZER_METRIC,
  AUTHORIZER_METRIC_IN_PROMETHEUS,
  LOGIN_METRIC,
  LOGIN_METRIC_IN_PROMETHEUS,
  countAuthorizerDecision,
  countLogin,
  loginResultFromErrorCode,
} from '../../src/adapters/observability/auth-metrics.js';
import { RecordingTelemetry } from '../support/fakes.js';

/**
 * Contrato de nomes com o repositorio mechanical-hub-infra.
 *
 * Os paineis e as regras de alerta referenciam estas series pelo nome exato.
 * Renomear qualquer uma nao quebra compilacao, nao gera erro de deploy e nao
 * aparece em log nenhum: o painel apenas fica vazio. Este teste transforma essa
 * falha silenciosa em falha de build.
 *
 * Ao alterar um nome aqui, altere junto:
 *   infra/modules/observability/dashboards/mechanical-hub-api.json
 */
describe('contrato de metricas com os paineis do Grafana', () => {
  it('publica os nomes que o Grafana procura', () => {
    expect(LOGIN_METRIC_IN_PROMETHEUS).toBe('mechanical_hub_auth_login_total');
    expect(AUTHORIZER_METRIC_IN_PROMETHEUS).toBe('mechanical_hub_auth_authorizer_total');
  });

  /**
   * O sufixo `_total` e acrescentado pelo exportador prometheusremotewrite do
   * coletor. Publicar ja com ele produziria `..._login_total_total`.
   */
  it('nao inclui o sufixo _total no nome enviado por OTLP', () => {
    expect(LOGIN_METRIC).not.toMatch(/_total$/);
    expect(AUTHORIZER_METRIC).not.toMatch(/_total$/);
    expect(`${LOGIN_METRIC}_total`).toBe(LOGIN_METRIC_IN_PROMETHEUS);
    expect(`${AUTHORIZER_METRIC}_total`).toBe(AUTHORIZER_METRIC_IN_PROMETHEUS);
  });
});

describe('loginResultFromErrorCode', () => {
  it('sem erro e sucesso', () => {
    expect(loginResultFromErrorCode(undefined)).toBe('success');
  });

  it('bloqueio por tentativas tem rotulo proprio', () => {
    // O alerta de pico de falha de login precisa distinguir "senha errada" de
    // "conta bloqueada" — sao problemas diferentes.
    expect(loginResultFromErrorCode('TOO_MANY_ATTEMPTS')).toBe('blocked');
  });

  it('falha interna tem rotulo proprio', () => {
    expect(loginResultFromErrorCode('INTERNAL_ERROR')).toBe('error');
  });

  /**
   * Os demais codigos viram um unico rotulo de proposito: a granularidade fica
   * no log, que carrega o `reason` exato. Uma etiqueta por codigo multiplicaria
   * as series sem responder nenhuma pergunta do painel.
   */
  it.each(['INVALID_CREDENTIALS', 'INVALID_CPF', 'USER_INACTIVE', 'INVALID_REQUEST'])(
    '%s vira failed',
    (code) => {
      expect(loginResultFromErrorCode(code)).toBe('failed');
    },
  );
});

describe('emissao dos contadores', () => {
  it('conta login com a etiqueta result', () => {
    const telemetry = new RecordingTelemetry();

    countLogin(telemetry, 'success');
    countLogin(telemetry, 'failed');
    countLogin(telemetry, 'failed');

    expect(telemetry.totalFor(LOGIN_METRIC, ['result', 'failed'])).toBe(2);
    expect(telemetry.totalFor(LOGIN_METRIC, ['result', 'success'])).toBe(1);
  });

  it('conta decisao do autorizador com a etiqueta decision', () => {
    const telemetry = new RecordingTelemetry();

    countAuthorizerDecision(telemetry, 'allow');
    countAuthorizerDecision(telemetry, 'deny');

    expect(telemetry.totalFor(AUTHORIZER_METRIC, ['decision', 'allow'])).toBe(1);
    expect(telemetry.totalFor(AUTHORIZER_METRIC, ['decision', 'deny'])).toBe(1);
  });
});
