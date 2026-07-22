import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getDispatchItemDiagnosticNote,
  getDispatchItemErrorCategoryLabel,
} from './dispatches';

describe('diagnostico de DispatchItem (UI)', () => {
  it('FAILED explica ausencia de retry automatico', () => {
    assert.match(
      getDispatchItemDiagnosticNote('FAILED') ?? '',
      /n[aã]o haver[aá] retry autom[aá]tico/i,
    );
  });

  it('RETRY_SCHEDULED avisa que SEND=false bloqueia Evolution', () => {
    assert.match(
      getDispatchItemDiagnosticNote('RETRY_SCHEDULED') ?? '',
      /DISPATCH_SEND_ENABLED=false/i,
    );
  });

  it('UNKNOWN_PROVIDER_STATE alerta contra reenvio automatico', () => {
    assert.match(
      getDispatchItemDiagnosticNote('UNKNOWN_PROVIDER_STATE') ?? '',
      /n[aã]o reenvie automaticamente/i,
    );
  });

  it('rotulos de categoria sao seguros e legiveis', () => {
    assert.equal(
      getDispatchItemErrorCategoryLabel('CONTENT_REJECTED'),
      'Conteúdo rejeitado',
    );
    assert.equal(
      getDispatchItemErrorCategoryLabel('INVALID_DESTINATION'),
      'Destino inválido',
    );
    assert.equal(getDispatchItemErrorCategoryLabel(null), '—');
  });
});
