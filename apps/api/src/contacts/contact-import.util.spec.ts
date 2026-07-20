import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ContactStatus } from '@prisma/client';
import {
  buildImportAuditMetadata,
  parseAndValidateImportCsv,
  parseTagNames,
  resolveImportNameUpdate,
  shouldPreserveBlockedStatus,
} from './contact-import.util';

describe('parseAndValidateImportCsv', () => {
  it('aceita contato novo valido', () => {
    const result = parseAndValidateImportCsv(
      'nome,telefone\nMaria,(11) 98888-7777\n',
    );

    assert.equal(result.errors.length, 0);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, 'Maria');
    assert.equal(result.rows[0].phone, '11988887777');
  });

  it('normaliza telefone de contato existente para deduplicacao', () => {
    const result = parseAndValidateImportCsv(
      'nome,telefone\nJoao,11 98888-7777\n',
    );

    assert.equal(result.rows[0].phone, '11988887777');
  });

  it('ignora telefone invalido com erro de validacao', () => {
    const result = parseAndValidateImportCsv('nome,telefone\nAna,123\n');

    assert.equal(result.rows.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].reason, 'Telefone invalido');
  });

  it('associa tags quando informadas', () => {
    const result = parseAndValidateImportCsv(
      'nome,telefone,tags\nAna,11988887777,"Voluntario; VIP"\n',
    );

    assert.deepEqual(result.rows[0].tagNames, ['Voluntario', 'VIP']);
  });

  it('aceita observacao opcional', () => {
    const result = parseAndValidateImportCsv(
      'nome,telefone,observacao\nAna,11988887777,Ligar amanha\n',
    );

    assert.equal(result.rows[0].note, 'Ligar amanha');
  });
});

describe('shouldPreserveBlockedStatus', () => {
  it('preserva opt-out/bloqueio existente', () => {
    assert.equal(shouldPreserveBlockedStatus(ContactStatus.BLOCKED), true);
    assert.equal(shouldPreserveBlockedStatus(ContactStatus.ACTIVE), false);
  });
});

describe('resolveImportNameUpdate', () => {
  it('atualiza nome de contato existente quando informado', () => {
    assert.equal(resolveImportNameUpdate('Novo Nome', 'Antigo'), 'Novo Nome');
    assert.equal(resolveImportNameUpdate(null, 'Antigo'), undefined);
  });
});

describe('parseTagNames / audit', () => {
  it('normaliza lista de tags', () => {
    assert.deepEqual(parseTagNames(' A ; B | A '), ['A', 'B']);
  });

  it('nao inclui telefones no metadata de auditoria', () => {
    const metadata = buildImportAuditMetadata({
      created: 1,
      updated: 1,
      ignored: 0,
      errors: 1,
      totalRows: 3,
    });

    assert.equal(metadata.source, 'csv');
    assert.equal('phone' in metadata, false);
    assert.equal('phones' in metadata, false);
  });
});
