import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_OPT_OUT_KEYWORDS,
  matchOptOutKeyword,
  normalizeOptOutText,
} from './opt-out-keywords.util';

describe('matchOptOutKeyword', () => {
  it('sair isolado → opt-out', () => {
    const r = matchOptOutKeyword('sair', [...DEFAULT_OPT_OUT_KEYWORDS]);
    assert.equal(r.matched, true);
    assert.equal(r.keyword, 'sair');
  });

  it('PARAR! → opt-out', () => {
    const r = matchOptOutKeyword('PARAR!', [...DEFAULT_OPT_OUT_KEYWORDS]);
    assert.equal(r.matched, true);
  });

  it('nao quero receber → opt-out', () => {
    const r = matchOptOutKeyword('não quero receber', [...DEFAULT_OPT_OUT_KEYWORDS]);
    assert.equal(r.matched, true);
  });

  it('frase ambigua longa nao gera falso positivo', () => {
    const r = matchOptOutKeyword(
      'nao quero parar de receber as noticias da campanha porque sao uteis',
      [...DEFAULT_OPT_OUT_KEYWORDS],
    );
    assert.equal(r.matched, false);
    assert.equal(r.reason, 'LONG_AMBIGUOUS_MESSAGE');
  });

  it('normalize remove acentos e pontuacao', () => {
    assert.equal(normalizeOptOutText('  Sair!!! '), 'sair');
  });
});
