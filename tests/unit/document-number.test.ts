import { describe, expect, it } from 'vitest';
import {
  isValidDocumentNumber,
  maskDocumentNumber,
  normalizeDocumentNumber,
} from '../../src/core/domain/document-number.js';

describe('normalizeDocumentNumber', () => {
  it('remove mascara e mantem apenas digitos', () => {
    expect(normalizeDocumentNumber('529.982.247-25')).toBe('52998224725');
    expect(normalizeDocumentNumber('529 982 247 25')).toBe('52998224725');
  });
});

describe('isValidDocumentNumber', () => {
  it.each(['52998224725', '529.982.247-25', '11144477735'])('aceita %s', (value) => {
    expect(isValidDocumentNumber(value)).toBe(true);
  });

  it('rejeita digito verificador incorreto', () => {
    expect(isValidDocumentNumber('52998224726')).toBe(false);
  });

  it('rejeita tamanho diferente de 11 digitos', () => {
    expect(isValidDocumentNumber('5299822472')).toBe(false);
    expect(isValidDocumentNumber('529982247250')).toBe(false);
  });

  it('rejeita sequencia de digitos repetidos', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(isValidDocumentNumber(String(digit).repeat(11))).toBe(false);
    }
  });

  it('rejeita valor vazio, nulo ou nao textual', () => {
    expect(isValidDocumentNumber('')).toBe(false);
    expect(isValidDocumentNumber(null)).toBe(false);
    expect(isValidDocumentNumber(undefined)).toBe(false);
    expect(isValidDocumentNumber(52998224725 as unknown as string)).toBe(false);
  });

  it('rejeita texto sem digitos suficientes', () => {
    expect(isValidDocumentNumber('abcdefghijk')).toBe(false);
  });
});

describe('maskDocumentNumber', () => {
  it('mantem apenas os ultimos cinco digitos visiveis', () => {
    expect(maskDocumentNumber('52998224725')).toBe('***.***.247-25');
  });

  it('nao vaza valor quando o documento e invalido', () => {
    expect(maskDocumentNumber('123')).toBe('***');
    expect(maskDocumentNumber(null)).toBe('***');
  });
});
