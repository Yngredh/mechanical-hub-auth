#!/usr/bin/env bash
#
# =============================================================================
# Mechanical Hub — demonstracao do fluxo de autenticacao (Fase 3)
# =============================================================================
#
# Roteiro em 8 atos, na ordem que conta a historia:
#
#   1. Rota publica do cliente final          -> 200  (sem token nenhum)
#   2. Rota protegida sem token               -> 401  (barrado no API Gateway)
#   3. Login com CPF invalido                 -> 400  (nem chega no banco)
#   4. Login com senha errada                 -> 401  (chega, mas nao passa)
#   5. Login correto do mecanico              -> 200  + JWT
#   6. Rota do mecanico com token             -> 200  (autorizado)
#   7. Rota exclusiva do admin, token mecanico-> 403  (RBAC no autorizador)
#   8. Token adulterado                       -> 401/403 (assinatura invalida)
#
# -----------------------------------------------------------------------------
# NAO INVERTA A ORDEM DOS ATOS 6 E 7.
#
# O autorizador do API Gateway tem cache (authorizer_result_ttl_in_seconds =
# 300) com chave no cabecalho Authorization, e a politica que ele devolve usa
# recurso curinga (toWildcardResource -> apiId/stage/*/*). Ou seja: a PRIMEIRA
# rota protegida chamada com um token define a politica que fica cacheada para
# TODAS as rotas daquele token pelos 5 minutos seguintes.
#
#   6 antes de 7 (ordem deste script): Allow cacheado; o 403 do ato 7 vem da
#   SecurityConfiguration do monolito, que aplica a mesma matriz. Resultado
#   correto na tela.
#
#   7 antes de 6: Deny curinga cacheado; o ato 6 tomaria 403 indevido ate o
#   cache expirar. Demonstracao arruinada no meio da gravacao.
#
# Para ver o 403 vindo do proprio autorizador, chame /customers com um token
# recem-emitido (rode so ate o ato 5, depois va direto ao 7) ou espere os
# 5 minutos de TTL entre os dois.
# -----------------------------------------------------------------------------
#
# Uso:
#   ./demo-auth.sh                 # pausa a cada ato (aperte ENTER para seguir)
#   ./demo-auth.sh --auto          # sem pausas, 2s entre atos
#
# Configuracao (tudo tem default, sobrescreva pelo ambiente se precisar):
#   API_BASE_URL     URL base da API      (default: valor do output api_base_url)
#   CPF_MECANICO     CPF do mecanico      (default: 11144477735)
#   SENHA_MECANICO   senha do mecanico    (default: a do seed V15)
#   CPF_ADMIN        CPF do administrador (default: 52998224725)
#   SENHA_ADMIN      senha do admin       (opcional: habilita o ato 7b)
#   OS_PUBLICA       numero da OS do seed (default: OS-202604-0001)
#
# Exemplo com a senha do admin:
#   SENHA_ADMIN='...' ./demo-auth.sh
#
# =============================================================================

set -uo pipefail

API="${API_BASE_URL:-https://ac4bh9hd27.execute-api.us-east-1.amazonaws.com/prod}"
CPF_MECANICO="${CPF_MECANICO:-11144477735}"
SENHA_MECANICO="${SENHA_MECANICO:-mech4nic0D3fault}"
CPF_ADMIN="${CPF_ADMIN:-52998224725}"
SENHA_ADMIN="${SENHA_ADMIN:-}"
OS_PUBLICA="${OS_PUBLICA:-OS-202604-0001}"

AUTO=0
[ "${1:-}" = "--auto" ] && AUTO=1

# --- Apresentacao ------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RESET=$'\033[0m'
  VERDE=$'\033[32m'; VERM=$'\033[31m'; AMAR=$'\033[33m'; AZUL=$'\033[36m'
else
  BOLD=''; DIM=''; RESET=''; VERDE=''; VERM=''; AMAR=''; AZUL=''
fi

ato() {
  printf '\n%s\n' "${AZUL}${BOLD}══════════════════════════════════════════════════════════════${RESET}"
  printf '%s\n'   "${AZUL}${BOLD} $1${RESET}"
  printf '%s\n\n' "${AZUL}${BOLD}══════════════════════════════════════════════════════════════${RESET}"
}

narra()  { printf '%s\n\n' "${DIM}$1${RESET}"; }
comando(){ printf '%s\n' "${BOLD}\$ $1${RESET}"; }

pausa() {
  if [ "$AUTO" = "1" ]; then sleep 2; else
    printf '\n%s' "${DIM}   [ENTER para o proximo ato]${RESET}"
    read -r _ </dev/tty || true
  fi
}

json_bonito() {
  if command -v jq >/dev/null 2>&1; then jq . 2>/dev/null || cat
  elif command -v python3 >/dev/null 2>&1; then python3 -m json.tool 2>/dev/null || cat
  else cat
  fi
}

# Mostra status colorido + corpo formatado. Espera receber "corpo\nSTATUS".
mostra_resposta() {
  local bruto="$1" esperado="$2"
  local status="${bruto##*$'\n'}"
  local corpo="${bruto%$'\n'*}"
  local cor="$VERM"

  [ "$status" = "$esperado" ] && cor="$VERDE"

  printf '\n  %sHTTP %s%s' "${cor}${BOLD}" "$status" "${RESET}"
  printf '   %s(esperado: %s)%s\n\n' "$DIM" "$esperado" "$RESET"

  if [ -n "$corpo" ]; then
    printf '%s' "$corpo" | json_bonito | sed 's/^/  /'
    printf '\n'
  fi
}

chamada() {
  curl -s -w $'\n%{http_code}' --max-time 30 "$@" 2>/dev/null
}

# Decodifica o payload do JWT (base64url) sem precisar de biblioteca.
claims_do_token() {
  local token="$1" payload pad
  payload="${token#*.}"
  payload="${payload%%.*}"
  payload="$(printf '%s' "$payload" | tr '_-' '/+')"
  pad=$(( ${#payload} % 4 ))
  [ "$pad" -ne 0 ] && payload="${payload}$(printf '=%.0s' $(seq 1 $((4 - pad))))"
  printf '%s' "$payload" | base64 -d 2>/dev/null | json_bonito
}

# =============================================================================

clear 2>/dev/null || true
printf '%s\n' "${BOLD}Mechanical Hub — fluxo de autenticacao${RESET}"
printf '%s\n' "${DIM}API: ${API}${RESET}"

# --- Ato 1 -------------------------------------------------------------------

ato "ATO 1 — O cliente final NAO faz login"
narra "Consulta de OS por numero. Rota publica: nenhum cabecalho Authorization.
O cliente da oficina nunca tem conta (ADR-0001) — so os funcionarios autenticam."

comando "curl ${API}/mechanical-hub/service-orders/${OS_PUBLICA}"
mostra_resposta "$(chamada -X GET "${API}/mechanical-hub/service-orders/${OS_PUBLICA}")" "200"
narra "Um 404 aqui tambem serve ao argumento: a requisicao chegou na aplicacao
em vez de ser barrada pelo gateway. O que importa e nao ter tomado 401."
pausa

# --- Ato 2 -------------------------------------------------------------------

ato "ATO 2 — Rota protegida, sem token"
narra "Mesma API, rota interna. O autorizador rejeita antes de a requisicao
chegar na aplicacao: o monolito nunca ve esta chamada."

comando "curl ${API}/service-orders"
mostra_resposta "$(chamada -X GET "${API}/service-orders")" "401"
pausa

# --- Ato 3 -------------------------------------------------------------------

ato "ATO 3 — Login com CPF invalido"
narra "Digitos verificadores nao fecham. A funcao rejeita na validacao sintatica,
antes de abrir conexao com o banco — CPF malformado nao vira consulta SQL."

comando "curl -X POST ${API}/auth/login -d '{\"cpf\":\"11111111111\",...}'"
mostra_resposta "$(chamada -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"11111111111","password":"qualquer"}')" "400"
pausa

# --- Ato 4 -------------------------------------------------------------------

ato "ATO 4 — Login com senha errada"
narra "CPF valido e existente, senha incorreta. Repare que a resposta e
identica a de um CPF inexistente: nao da para descobrir quem tem conta."

comando "curl -X POST ${API}/auth/login -d '{\"cpf\":\"${CPF_MECANICO}\",\"password\":\"errada\"}'"
mostra_resposta "$(chamada -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"cpf\":\"${CPF_MECANICO}\",\"password\":\"senha-errada\"}")" "401"
pausa

# --- Ato 5 -------------------------------------------------------------------

ato "ATO 5 — Login do mecanico"
narra "Credencial correta. A funcao serverless consulta o banco com uma role
somente-leitura (mechanical_hub_auth), confere o hash BCrypt e emite o JWT."

comando "curl -X POST ${API}/auth/login -d '{\"cpf\":\"${CPF_MECANICO}\",\"password\":\"********\"}'"

RESP_MEC="$(chamada -X POST "${API}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"cpf\":\"${CPF_MECANICO}\",\"password\":\"${SENHA_MECANICO}\"}")"
mostra_resposta "$RESP_MEC" "200"

TOKEN_MEC="$(printf '%s' "${RESP_MEC%$'\n'*}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"

if [ -z "$TOKEN_MEC" ]; then
  printf '%s\n' "${VERM}${BOLD}  Login falhou — os atos seguintes precisam do token. Abortando.${RESET}"
  exit 1
fi

printf '%s\n' "${BOLD}  Claims dentro do token:${RESET}"
claims_do_token "$TOKEN_MEC" | sed 's/^/  /'
narra "
O 'role' vindo do banco e o que o autorizador usa para decidir cada rota."
pausa

# --- Ato 6 -------------------------------------------------------------------

ato "ATO 6 — Mesma rota do ato 2, agora com token"
narra "O autorizador valida a assinatura, confere a matriz rota x perfil e
libera. A identidade segue para a aplicacao nos cabecalhos x-user-*."

comando "curl ${API}/service-orders -H 'Authorization: Bearer \$TOKEN'"
mostra_resposta "$(chamada -X GET "${API}/service-orders" \
  -H "Authorization: Bearer ${TOKEN_MEC}")" "200"
pausa

# --- Ato 7 -------------------------------------------------------------------

ato "ATO 7 — Rota exclusiva do administrador, com token de mecanico"
narra "Token perfeitamente valido — assinatura correta, dentro da validade.
O que barra aqui e o PERFIL: gestao de clientes e so do administrador."

comando "curl ${API}/customers -H 'Authorization: Bearer \$TOKEN_DO_MECANICO'"
mostra_resposta "$(chamada -X GET "${API}/customers" \
  -H "Authorization: Bearer ${TOKEN_MEC}")" "403"
pausa

# --- Ato 7b (opcional) -------------------------------------------------------

if [ -n "$SENHA_ADMIN" ]; then
  ato "ATO 7b — A mesma rota, agora com token de administrador"
  narra "Mesmo endpoint, mesma requisicao. So muda quem esta autenticado."

  RESP_ADM="$(chamada -X POST "${API}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"cpf\":\"${CPF_ADMIN}\",\"password\":\"${SENHA_ADMIN}\"}")"
  TOKEN_ADM="$(printf '%s' "${RESP_ADM%$'\n'*}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"

  if [ -n "$TOKEN_ADM" ]; then
    printf '%s\n' "${BOLD}  Claims do administrador:${RESET}"
    claims_do_token "$TOKEN_ADM" | sed 's/^/  /'
    printf '\n'
    comando "curl ${API}/customers -H 'Authorization: Bearer \$TOKEN_DO_ADMIN'"
    mostra_resposta "$(chamada -X GET "${API}/customers" \
      -H "Authorization: Bearer ${TOKEN_ADM}")" "200"
  else
    printf '%s\n' "${AMAR}  Login do admin falhou — conferir SENHA_ADMIN.${RESET}"
  fi
  pausa
fi

# --- Ato 8 -------------------------------------------------------------------

ato "ATO 8 — Token adulterado"
narra "Mesmo token do ato 6, com um caractere trocado na assinatura.
Sem a chave de assinatura, alterar o perfil dentro do token nao adianta."

ULTIMO="${TOKEN_MEC: -1}"
if [ "$ULTIMO" = "X" ]; then TOKEN_FALSO="${TOKEN_MEC%?}Y"; else TOKEN_FALSO="${TOKEN_MEC%?}X"; fi

comando "curl ${API}/service-orders -H 'Authorization: Bearer \$TOKEN_ADULTERADO'"
mostra_resposta "$(chamada -X GET "${API}/service-orders" \
  -H "Authorization: Bearer ${TOKEN_FALSO}")" "401"

# --- Fecho -------------------------------------------------------------------

printf '\n%s\n' "${VERDE}${BOLD}══════════════════════════════════════════════════════════════${RESET}"
printf '%s\n'   "${VERDE}${BOLD} Fim da demonstracao${RESET}"
printf '%s\n\n' "${VERDE}${BOLD}══════════════════════════════════════════════════════════════${RESET}"
printf '%s\n'   "  Publico sem token .......... 200"
printf '%s\n'   "  Protegido sem token ........ 401"
printf '%s\n'   "  CPF invalido ............... 400  (barrado antes do banco)"
printf '%s\n'   "  Senha errada ............... 401  (resposta indistinguivel)"
printf '%s\n'   "  Login correto .............. 200  + JWT"
printf '%s\n'   "  Rota do perfil ............. 200"
printf '%s\n'   "  Rota de outro perfil ....... 403  (RBAC)"
printf '%s\n\n' "  Token adulterado ........... 401  (assinatura)"
