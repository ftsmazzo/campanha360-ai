import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertFrozenItemContentReady } from './content-send-guard.util';
import { hashContentText } from './content-selection.util';

describe('assertFrozenItemContentReady', () => {
  it('aceita snapshot legado com hash coerente', () => {
    const body = 'Ola mundo';
    const r = assertFrozenItemContentReady({
      body,
      hash: hashContentText(body),
    });
    assert.equal(r.ok, true);
  });

  it('bloqueia placeholder residual', () => {
    const body = 'Ola {{firstName}}';
    const r = assertFrozenItemContentReady({
      body,
      hash: hashContentText(body),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errorCode, 'CONTENT_VARIABLE_UNRESOLVED');
  });

  it('bloqueia mismatch de hash', () => {
    const r = assertFrozenItemContentReady({
      body: 'abc',
      hash: 'deadbeef',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.errorCode, 'CONTENT_SNAPSHOT_MISMATCH');
  });

  it('bloqueia personalization BLOCKED', () => {
    const body = 'x';
    const r = assertFrozenItemContentReady({
      body,
      hash: hashContentText(body),
      personalizationStatus: 'BLOCKED',
    });
    assert.equal(r.ok, false);
  });
});
