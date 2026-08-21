output "api_base_url" {
  description = "URL base da API. E o unico endereco que os clientes devem conhecer."
  value       = aws_api_gateway_stage.this.invoke_url
}

output "login_url" {
  description = "Endpoint de login"
  value       = "${aws_api_gateway_stage.this.invoke_url}/auth/login"
}

output "authenticate_function_name" {
  value = aws_lambda_function.authenticate.function_name
}

output "authorize_function_name" {
  value = aws_lambda_function.authorize.function_name
}

output "rest_api_id" {
  value = aws_api_gateway_rest_api.this.id
}

output "lambda_security_group_id" {
  description = "Security group das funcoes, criado neste repositorio (ADR-0002)"
  value       = aws_security_group.lambda.id
}

output "vpc_link_id" {
  description = "VPC Link usado pelas integracoes privadas do API Gateway ate o NLB da aplicacao (item 47)."
  value       = aws_api_gateway_vpc_link.app.id
}

# Ecoam o que foi efetivamente resolvido dos states remotos. Servem para
# conferir, no output do apply, se a pipeline leu o ambiente certo -- util
# depois de um reset do Lab, quando os ids mudam.
output "resolved_vpc_id" {
  description = "VPC em uso (do state de infra, ou do override)"
  value       = local.vpc_id
}

output "resolved_subnet_ids" {
  description = "Subnets privadas em uso (do state de infra, ou do override)"
  value       = local.subnet_ids
}

output "resolved_database_host" {
  description = "Endpoint do banco em uso (do state de database, ou do override)"
  value       = local.database_host
}

output "resolved_app_backend_url" {
  description = "URL do NLB interno da aplicacao, resolvida do state de mechanical-hub-infra."
  value       = local.application_base_url
}
