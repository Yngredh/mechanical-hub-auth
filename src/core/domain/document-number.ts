/**
 * Numero de documento do funcionario (CPF nesta fase).
 *
 * Regra de fronteira: o mundo externo pode mandar com ou sem mascara; daqui
 * para dentro circula sempre normalizado, so digitos. E a mesma normalizacao
 * que a aplicacao principal aplica antes de gravar em users.document_number.
 */

const DIGITS_ONLY = /\D/g;
const REPEATED_DIGITS = /^(\d)\1{10}$/;
const EXPECTED_LENGTH = 11;

export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(DIGITS_ONLY, '');
}

export function isValidDocumentNumber(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;

  const value = normalizeDocumentNumber(raw);

  if (value.length !== EXPECTED_LENGTH) return false;
  if (REPEATED_DIGITS.test(value)) return false;

  return (
    checkDigit(value, 9, 10) === digitAt(value, 9) &&
    checkDigit(value, 10, 11) === digitAt(value, 10)
  );
}

/**
 * Mascara para log. Dado pessoal (LGPD) nao pode sair inteiro em log
 * estruturado, mas os ultimos digitos ajudam no suporte.
 */
export function maskDocumentNumber(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '***';

  const value = normalizeDocumentNumber(raw);
  if (value.length !== EXPECTED_LENGTH) return '***';

  return `***.***.${value.slice(6, 9)}-${value.slice(9, 11)}`;
}

function digitAt(value: string, index: number): number {
  return Number(value[index]);
}

function checkDigit(value: string, length: number, startWeight: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += digitAt(value, i) * (startWeight - i);
  }

  const remainder = 11 - (sum % 11);
  return remainder >= 10 ? 0 : remainder;
}
