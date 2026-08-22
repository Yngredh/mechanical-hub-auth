variable "project_name" {
  description = "Prefixo aplicado ao nome de todos os recursos"
  type        = string
  default     = "mechanical-hub"
}

variable "environment" {
  description = "Ambiente (stage do API Gateway e sufixo dos recursos)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "Regiao AWS. O AWS Academy Lab so libera us-east-1"
  type        = string
  default     = "us-east-1"
}

# --- Identidade ---------------------------------------------------------------

variable "lambda_execution_role_arn" {
  description = <<-EOT
    ARN da role de execucao das funcoes.

    No AWS Academy Lab nao ha permissao para criar IAM roles: use a LabRole
    existente (arn:aws:iam::<conta>:role/LabRole). Em uma conta comum, aponte
    para uma role dedicada com o minimo necessario.
  EOT
  type        = string
}

# --- States remotos -----------------------------------------------------------
#
# ADR-0002: os valores de rede e de banco vem dos states dos repositorios
# aplicados antes deste (mechanical-hub-infra e mechanical-hub-database), e nao
# de secrets preenchidos a mao.

variable "infra_state_bucket" {
  description = "Bucket S3 com o state do mechanical-hub-infra"
  type        = string
}

variable "infra_state_key" {
  description = "Chave do state do mechanical-hub-infra dentro do bucket"
  type        = string
  default     = "mechanical-hub-infra/terraform.tfstate"
}

variable "database_state_bucket" {
  description = "Bucket S3 com o state do mechanical-hub-database"
  type        = string
}

variable "database_state_key" {
  description = "Chave do state do mechanical-hub-database dentro do bucket"
  type        = string
  default     = "mechanical-hub-database/terraform.tfstate"
}

variable "state_region" {
  description = "Regiao dos buckets de state. Vazio usa aws_region."
  type        = string
  default     = ""
}

# --- Rede ---------------------------------------------------------------------
#
# Overrides opcionais. Vazio = resolve pelo state remoto (comportamento padrao).
# Preencher apenas para apontar para um ambiente avulso ou para destravar um
# deploy caso algum state esteja indisponivel.

variable "vpc_id" {
  description = "Override do vpc_id. Vazio le do state do mechanical-hub-infra."
  type        = string
  default     = ""
}

variable "vpc_subnet_ids" {
  description = "Override das subnets privadas. Vazio le private_subnet_ids do state do mechanical-hub-infra."
  type        = list(string)
  default     = []
}

variable "database_egress_cidrs" {
  description = "Override dos CIDRs de egress do security group. Vazio usa o CIDR da propria VPC."
  type        = list(string)
  default     = []
}

variable "allow_https_egress" {
  description = "Libera 443 no security group. Necessario apenas ao migrar SECRET_PROVIDER para aws-secrets-manager via VPC endpoint."
  type        = bool
  default     = false
}

# --- Banco --------------------------------------------------------------------
#
# Mesmo padrao: vazio/null resolve pelo state do mechanical-hub-database.

variable "database_host" {
  description = "Override do endpoint do banco. Vazio le rds_endpoint do state do mechanical-hub-database. Sem RDS Proxy no lab; a conexao e direta."
  type        = string
  default     = ""
}

variable "database_port" {
  description = "Override da porta do banco. null le rds_port do state do mechanical-hub-database."
  type        = number
  default     = null
}

variable "database_name" {
  description = "Override do nome do banco. Vazio le rds_db_name do state do mechanical-hub-database."
  type        = string
  default     = ""
}

variable "database_user" {
  description = "Usuario de banco dedicado a autenticacao, somente leitura. A role e criada pelo repositorio mechanical-hub-database (sql/auth-database-role.sql), conforme ADR-0002."
  type        = string
  default     = "mechanical_hub_auth"
}

# Continua vindo de secret, e nao de output de state: valores sensiveis nao
# trafegam por output de Terraform, que fica gravado em claro no arquivo de
# state. Precisa ser a mesma senha usada no AUTH_DB_PASSWORD do
# mechanical-hub-database, que cria a role.
variable "database_password" {
  description = "Senha do usuario de banco. Injetada pelo pipeline a partir de um secret do repositorio."
  type        = string
  sensitive   = true
}

variable "database_ssl" {
  description = "Habilita TLS na conexao com o banco"
  type        = bool
  default     = true
}

# --- Token --------------------------------------------------------------------

variable "token_signing_key" {
  description = "Chave HS256 usada para assinar e verificar o token. Minimo de 32 caracteres."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.token_signing_key) >= 32
    error_message = "A chave de assinatura precisa ter ao menos 32 caracteres."
  }
}

variable "token_issuer" {
  description = "Claim iss do token"
  type        = string
  default     = "mechanical-hub-auth"
}

variable "token_audience" {
  description = "Claim aud do token"
  type        = string
  default     = "mechanical-hub-api"
}

variable "token_ttl_seconds" {
  description = "Validade do token em segundos"
  type        = number
  default     = 7200
}

# --- Ajustes de execucao ------------------------------------------------------

variable "lambda_memory_mb" {
  description = "Memoria das funcoes. Mais memoria tambem significa mais CPU, o que reduz o cold start."
  type        = number
  default     = 512
}

variable "lambda_timeout_seconds" {
  description = "Timeout das funcoes"
  type        = number
  default     = 15
}

variable "authorizer_cache_ttl_seconds" {
  description = <<-EOT
    Cache da decisao do autorizador, por token.

    Reduz invocacoes e latencia, mas atrasa o efeito de uma desativacao de
    funcionario. 0 desliga o cache.
  EOT
  type        = number
  default     = 300
}

variable "log_retention_days" {
  description = "Retencao dos logs no CloudWatch"
  type        = number
  default     = 14
}

variable "login_throttle_rate" {
  description = "Requisicoes por segundo permitidas na rota de login"
  type        = number
  default     = 20
}

variable "login_throttle_burst" {
  description = "Pico de requisicoes permitido na rota de login"
  type        = number
  default     = 40
}
