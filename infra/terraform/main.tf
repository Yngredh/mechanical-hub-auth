terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Configuracao parcial: bucket e regiao vem do -backend-config no init, para
  # nao versionar o nome do bucket e permitir que cada ambiente use o seu.
  #
  #   terraform init \
  #     -backend-config="bucket=<bucket-de-state>" \
  #     -backend-config="region=us-east-1"
  backend "s3" {
    key     = "mechanical-hub-auth/terraform.tfstate"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
}

# =============================================================================
# States remotos dos repositorios anteriores na ordem de provisionamento
#
# ADR-0002: cada repositorio exporta outputs explicitos, e os consumidores leem
# esses valores via terraform_remote_state -- nunca por hardcode de IDs ou
# endpoints.
#
# Ganho concreto no ciclo do AWS Academy Lab: a cada reset do ambiente, subnets
# e endpoint do RDS mudam. Lendo do state, a pipeline pega os valores atuais
# sozinha, em vez de exigir que alguem reedite secrets no GitHub antes de
# qualquer deploy funcionar.
# =============================================================================

data "terraform_remote_state" "infra" {
  backend = "s3"

  config = {
    bucket = var.infra_state_bucket
    key    = var.infra_state_key
    region = var.state_region != "" ? var.state_region : var.aws_region
  }
}

data "terraform_remote_state" "database" {
  backend = "s3"

  config = {
    bucket = var.database_state_bucket
    key    = var.database_state_key
    region = var.state_region != "" ? var.state_region : var.aws_region
  }
}

locals {
  name_prefix = "${var.project_name}-auth-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Component   = "auth"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # --- Valores resolvidos a partir dos states remotos ------------------------
  #
  # As variaveis correspondentes continuam existindo como override opcional
  # (default vazio). Servem para desenvolvimento local contra um ambiente
  # avulso e para destravar um deploy se algum state estiver indisponivel --
  # mesmo padrao de fallback adotado no mechanical-hub-database.

  vpc_id = var.vpc_id != "" ? var.vpc_id : data.terraform_remote_state.infra.outputs.vpc_id

  subnet_ids = length(var.vpc_subnet_ids) > 0 ? var.vpc_subnet_ids : data.terraform_remote_state.infra.outputs.private_subnet_ids

  # O output rds_endpoint pode vir como "host:porta" (formato do atributo
  # `endpoint` do aws_db_instance) ou so o host (`address`). O split cobre os
  # dois casos: sem ele, o driver do Postgres tentaria resolver "host:5432"
  # como nome de maquina e a conexao falharia.
  database_host = var.database_host != "" ? var.database_host : split(":", data.terraform_remote_state.database.outputs.rds_endpoint)[0]

  database_port = var.database_port != null ? var.database_port : data.terraform_remote_state.database.outputs.rds_port

  database_name = var.database_name != "" ? var.database_name : data.terraform_remote_state.database.outputs.rds_db_name

  # NLB interno da aplicacao, provisionado pelo mechanical-hub-infra
  # (modules/app-lb) -- nao pelo Kubernetes. O AWS Load Balancer Controller
  # exigiria IRSA (IAM role nova via provedor OIDC), bloqueado no AWS Academy
  # Lab. Sem override aqui: ao contrario de rede/banco, este valor nao existia
  # antes do item 47 (era secret preenchido a mao) e sempre esta disponivel
  # assim que o mechanical-hub-infra aplica -- nao depende do deploy da
  # aplicacao ter rodado.
  app_nlb_arn          = data.terraform_remote_state.infra.outputs.app_nlb_arn
  application_base_url = data.terraform_remote_state.infra.outputs.app_backend_base_url

  # Configuracao comum as duas funcoes.
  #
  # SECRET_PROVIDER=environment porque o AWS Academy Lab nao libera o Secrets
  # Manager. Em uma conta comum, troque para "aws-secrets-manager" e informe
  # TOKEN_SIGNING_KEY_SECRET_ID / DATABASE_CREDENTIALS_SECRET_ID -- o codigo ja
  # suporta os dois modos atras da mesma porta (SecretProvider).
  token_environment = {
    SECRET_PROVIDER   = "environment"
    TOKEN_SIGNING_KEY = var.token_signing_key
    TOKEN_ISSUER      = var.token_issuer
    TOKEN_AUDIENCE    = var.token_audience
    TOKEN_TTL_SECONDS = tostring(var.token_ttl_seconds)
    SERVICE_NAME      = "${var.project_name}-auth"
    LOG_LEVEL         = "info"
  }
}

# =============================================================================
# Funcoes
# =============================================================================

resource "aws_lambda_function" "authenticate" {
  function_name = "${local.name_prefix}-authenticate"
  description   = "Valida CPF e senha do funcionario e emite o token de acesso"

  role    = var.lambda_execution_role_arn
  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = "${path.module}/../../build/authenticate.zip"
  source_code_hash = filebase64sha256("${path.module}/../../build/authenticate.zip")

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  # Precisa estar na VPC para alcancar o banco. Subnets e SG vem, respectivamente,
  # do state de infra e do recurso criado neste repositorio.
  vpc_config {
    subnet_ids         = local.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge(local.token_environment, {
      DATABASE_HOST     = local.database_host
      DATABASE_PORT     = tostring(local.database_port)
      DATABASE_NAME     = local.database_name
      DATABASE_USER     = var.database_user
      DATABASE_PASSWORD = var.database_password
      DATABASE_SSL      = tostring(var.database_ssl)

      MAX_FAILED_ATTEMPTS            = "5"
      FAILED_ATTEMPTS_WINDOW_SECONDS = "900"
    })
  }

  tags = merge(local.common_tags, { Function = "authenticate" })

  depends_on = [aws_cloudwatch_log_group.authenticate]
}

resource "aws_lambda_function" "authorize" {
  function_name = "${local.name_prefix}-authorize"
  description   = "Autorizador do API Gateway: valida o token e o perfil contra a rota"

  role    = var.lambda_execution_role_arn
  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = "${path.module}/../../build/authorize.zip"
  source_code_hash = filebase64sha256("${path.module}/../../build/authorize.zip")

  # Nao fala com o banco, entao nao entra na VPC: fora dela o cold start e
  # menor e nao consome ENI.
  memory_size = 256
  timeout     = 10

  environment {
    variables = local.token_environment
  }

  tags = merge(local.common_tags, { Function = "authorize" })

  depends_on = [aws_cloudwatch_log_group.authorize]
}

# =============================================================================
# Logs
# =============================================================================

resource "aws_cloudwatch_log_group" "authenticate" {
  name              = "/aws/lambda/${local.name_prefix}-authenticate"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "authorize" {
  name              = "/aws/lambda/${local.name_prefix}-authorize"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}
