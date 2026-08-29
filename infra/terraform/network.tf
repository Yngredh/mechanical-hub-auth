# O CIDR da VPC e lido pelo id, e nao por um output novo do mechanical-hub-infra.
# O contrato de outputs daquele repositorio (ADR-0002) e vpc_id e
# private_subnet_ids; pedir um terceiro output so para montar uma regra de SG
# ampliaria a interface publica entre repositorios sem necessidade.
data "aws_vpc" "this" {
  id = local.vpc_id
}

locals {
  # Egress restrito a propria VPC: o banco esta em subnet privada e nao ha nada
  # fora da rede que a funcao precise alcancar.
  database_egress_cidrs = length(var.database_egress_cidrs) > 0 ? var.database_egress_cidrs : [data.aws_vpc.this.cidr_block]
}

# =============================================================================
# Security group das funcoes
#
# Mora neste repositorio, e nao no mechanical-hub-infra, por decisao explicita
# da ADR-0002: criar o SG em `infra` apenas para o `database` conseguir
# referencia-lo produziria um recurso orfao, pertencente conceitualmente a
# `auth`, e aumentaria o acoplamento entre repositorios.
#
# O que fecha essa ponta e a liberacao por CIDR das subnets privadas no lado do
# banco: o RDS aceita conexoes da faixa inteira, entao nao precisa conhecer
# este SG -- o que tambem evita a dependencia circular (database e aplicado
# antes de auth).
# =============================================================================

resource "aws_security_group" "lambda" {
  # name_prefix em vez de name: o SG e referenciado pelas ENIs da funcao, e uma
  # substituicao precisa criar o novo antes de destruir o antigo.
  name_prefix = "${local.name_prefix}-lambda-"
  description = "Egress das funcoes de autenticacao para o banco"
  vpc_id      = local.vpc_id

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-lambda" })

  lifecycle {
    create_before_destroy = true
  }
}

# Unica saida permitida: a porta do banco, dentro da VPC.
#
# Nao ha regra de HTTPS porque, neste desenho, a funcao nao precisa: o envio de
# log para o CloudWatch nao passa pela ENI da VPC (e feito pelo servico Lambda,
# fora da rede do cliente), e os segredos vem de variavel de ambiente enquanto
# SECRET_PROVIDER=environment. Ao migrar para o Secrets Manager, sera preciso
# liberar 443 para um VPC endpoint -- ver a variavel allow_https_egress.
resource "aws_security_group_rule" "lambda_to_database" {
  security_group_id = aws_security_group.lambda.id
  type              = "egress"
  description       = "PostgreSQL"

  from_port   = local.database_port
  to_port     = local.database_port
  protocol    = "tcp"
  cidr_blocks = local.database_egress_cidrs
}

# Opcional e desligada por padrao. Necessaria apenas quando a funcao passar a
# resolver segredos por VPC endpoint (Secrets Manager / SSM).
resource "aws_security_group_rule" "lambda_https_egress" {
  count = var.allow_https_egress ? 1 : 0

  security_group_id = aws_security_group.lambda.id
  type              = "egress"
  description       = "HTTPS para VPC endpoints (Secrets Manager / SSM)"

  from_port   = 443
  to_port     = 443
  protocol    = "tcp"
  cidr_blocks = local.database_egress_cidrs
}

# =============================================================================
# Saida para o coletor OpenTelemetry (RFC-0004, etapa 3)
#
# O coletor esta no cluster, alcancavel de dentro da VPC por um listener no NLB
# interno (mechanical-hub-infra, modules/app-lb). Sem esta regra o egress do
# security group barra a conexao e toda exportacao termina em timeout — falha
# silenciosa: o login continua funcionando e os paineis simplesmente ficam
# vazios.
#
# A porta e derivada do proprio endereco resolvido, e nao de uma variavel
# separada: assim ela nao tem como divergir do que o infra publicou.
# =============================================================================

locals {
  # `try` com fallback para a porta OTLP padrao: um endereco informado a mao sem
  # porta explicita nao pode quebrar o apply com erro de indice.
  otlp_port = local.telemetry_enabled ? try(
    tonumber(regex(":(\\d+)$", local.otlp_endpoint)[0]), 4318
  ) : null
}

resource "aws_security_group_rule" "lambda_to_otlp_collector" {
  count = local.telemetry_enabled ? 1 : 0

  security_group_id = aws_security_group.lambda.id
  type              = "egress"
  description       = "OTLP/HTTP para o coletor OpenTelemetry, via NLB interno"

  from_port   = local.otlp_port
  to_port     = local.otlp_port
  protocol    = "tcp"
  cidr_blocks = local.database_egress_cidrs
}
