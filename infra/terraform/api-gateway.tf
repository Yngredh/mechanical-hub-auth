# =============================================================================
# API Gateway (REST v1)
#
# Desenho das rotas:
#
#   /auth/login              -> funcao authenticate            (publica)
#   /mechanical-hub/{proxy+} -> aplicacao principal            (publica, cliente final)
#   /actuator/{proxy+}       -> aplicacao principal            (publica, operacao)
#   /swagger-ui/{proxy+}     -> aplicacao principal            (publica, documentacao)
#   /v3/{proxy+}             -> aplicacao principal            (publica, documentacao)
#   /{proxy+}                -> aplicacao principal            (protegida pelo autorizador)
#
# As rotas publicas ficam em recursos proprios, e nao atras do autorizador, por
# uma limitacao concreta do API Gateway: com cache ligado, um autorizador do
# tipo REQUEST nega a requisicao sem nem invocar a funcao quando o
# identity_source (o cabecalho Authorization) esta ausente. Como o cliente
# final nunca manda token, ele receberia 401 antes de qualquer logica rodar.
#
# O caminho mais especifico vence: /mechanical-hub/{proxy+} tem precedencia
# sobre /{proxy+}.
# =============================================================================

resource "aws_api_gateway_rest_api" "this" {
  name        = local.name_prefix
  description = "Entrada unica da API do Mechanical Hub"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Autorizador
# -----------------------------------------------------------------------------

resource "aws_api_gateway_authorizer" "token" {
  name = "${local.name_prefix}-authorizer"
  type = "REQUEST"

  rest_api_id     = aws_api_gateway_rest_api.this.id
  authorizer_uri  = aws_lambda_function.authorize.invoke_arn
  identity_source = "method.request.header.Authorization"

  authorizer_result_ttl_in_seconds = var.authorizer_cache_ttl_seconds
}

# -----------------------------------------------------------------------------
# Conectividade privada ate a aplicacao principal
#
# Fecha o item 47 do plano: o Service da aplicacao nao tem mais IP publico
# (ver mechanical-hub/src/main/resources/k8s/service-app.yaml). As integracoes
# HTTP_PROXY abaixo alcancam o NLB interno provisionado pelo
# mechanical-hub-infra atraves deste VPC Link, em vez de um hostname publico.
# -----------------------------------------------------------------------------

resource "aws_api_gateway_vpc_link" "app" {
  name        = "${local.name_prefix}-vpc-link"
  description = "Conectividade privada ate o NLB interno da aplicacao principal (item 47)."
  target_arns = [local.app_nlb_arn]
}

# =============================================================================
# /auth/login  (publica)
# =============================================================================

resource "aws_api_gateway_resource" "auth" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "auth"
}

resource "aws_api_gateway_resource" "auth_login" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.auth.id
  path_part   = "login"
}

resource "aws_api_gateway_method" "auth_login_post" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.auth_login.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "auth_login_post" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.auth_login.id
  http_method = aws_api_gateway_method.auth_login_post.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.authenticate.invoke_arn
}

# =============================================================================
# Rotas publicas encaminhadas para a aplicacao principal
# =============================================================================

locals {
  public_paths = {
    mechanical_hub = "mechanical-hub"
    actuator       = "actuator"
    swagger_ui     = "swagger-ui"
    api_docs       = "v3"
  }
}

resource "aws_api_gateway_resource" "public_root" {
  for_each = local.public_paths

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = each.value
}

resource "aws_api_gateway_resource" "public_proxy" {
  for_each = local.public_paths

  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_resource.public_root[each.key].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "public_any" {
  for_each = local.public_paths

  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.public_proxy[each.key].id
  http_method   = "ANY"
  authorization = "NONE"

  request_parameters = {
    "method.request.path.proxy" = true
  }
}

resource "aws_api_gateway_integration" "public_any" {
  for_each = local.public_paths

  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.public_proxy[each.key].id
  http_method = aws_api_gateway_method.public_any[each.key].http_method

  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${local.application_base_url}/${each.value}/{proxy}"

  connection_type = "VPC_LINK"
  connection_id   = aws_api_gateway_vpc_link.app.id

  request_parameters = {
    "integration.request.path.proxy" = "method.request.path.proxy"
  }
}

# =============================================================================
# /{proxy+}  (protegida)
# =============================================================================

resource "aws_api_gateway_resource" "protected_proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "protected_any" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.protected_proxy.id
  http_method   = "ANY"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.token.id

  request_parameters = {
    "method.request.path.proxy"           = true
    "method.request.header.Authorization" = true
  }
}

resource "aws_api_gateway_integration" "protected_any" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.protected_proxy.id
  http_method = aws_api_gateway_method.protected_any.http_method

  type                    = "HTTP_PROXY"
  integration_http_method = "ANY"
  uri                     = "${local.application_base_url}/{proxy}"

  connection_type = "VPC_LINK"
  connection_id   = aws_api_gateway_vpc_link.app.id

  # A identidade resolvida pelo autorizador chega a aplicacao principal como
  # cabecalho. E o que o GatewayAuthenticationFilter do monolito consome --
  # assim ele nao precisa reabrir o token.
  request_parameters = {
    "integration.request.path.proxy"         = "method.request.path.proxy"
    "integration.request.header.x-user-id"   = "context.authorizer.userId"
    "integration.request.header.x-user-role" = "context.authorizer.role"
    "integration.request.header.x-user-name" = "context.authorizer.name"
  }
}

# =============================================================================
# Permissoes de invocacao
# =============================================================================

resource "aws_lambda_permission" "authenticate" {
  statement_id  = "AllowApiGatewayInvokeAuthenticate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authenticate.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorize" {
  statement_id  = "AllowApiGatewayInvokeAuthorize"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorize.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/authorizers/*"
}

# =============================================================================
# Deploy e stage
# =============================================================================

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # Forca novo deploy quando qualquer parte do desenho da API muda.
  triggers = {
    redeploy = sha1(jsonencode([
      aws_api_gateway_resource.auth_login.id,
      aws_api_gateway_method.auth_login_post.id,
      aws_api_gateway_integration.auth_login_post.id,
      aws_api_gateway_resource.protected_proxy.id,
      aws_api_gateway_method.protected_any.id,
      aws_api_gateway_integration.protected_any.id,
      aws_api_gateway_authorizer.token.id,
      aws_api_gateway_vpc_link.app.id,
      values(aws_api_gateway_integration.public_any)[*].id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.environment

  # `integrationLatency` separado de `responseLatency` responde a primeira
  # pergunta de toda reclamacao de lentidao: demorou no backend ou no Gateway?
  # `authorizerError` mostra a falha do autorizador, que de outro modo so
  # apareceria como um 500 sem explicacao.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn

    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      path               = "$context.path"
      status             = "$context.status"
      protocol           = "$context.protocol"
      responseLength     = "$context.responseLength"
      responseLatency    = "$context.responseLatency"
      integrationLatency = "$context.integration.latency"
      integrationStatus  = "$context.integration.status"
      authorizerError    = "$context.authorizer.error"
      error              = "$context.error.messageString"
      errorType          = "$context.error.responseType"
    })
  }

  tags = local.common_tags
}

# Throttling especifico da rota de login: primeira barreira contra forca bruta,
# antes do contador por documento que roda dentro da funcao.
resource "aws_api_gateway_method_settings" "login_throttle" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "auth/login/POST"

  settings {
    throttling_rate_limit  = var.login_throttle_rate
    throttling_burst_limit = var.login_throttle_burst
    metrics_enabled        = true
  }
}

# =============================================================================
# Logs do API Gateway
#
# Preenche o unico trecho do caminho que nao tinha visibilidade nenhuma: o que
# acontece ANTES da requisicao chegar na funcao ou na aplicacao. Sem isto, um
# 500 gerado pelo proprio Gateway — integracao inalcancavel, autorizador que
# estourou — aparecia so como "Internal server error" no corpo da resposta, e o
# diagnostico dependia de reproduzir na mao pelo CLI. Foi exatamente o que
# aconteceu no incidente do VPC Link.
# =============================================================================

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}