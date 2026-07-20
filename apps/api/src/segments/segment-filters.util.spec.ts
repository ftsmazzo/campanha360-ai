import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelType, ContactStatus } from '@prisma/client';
import {
  buildSegmentContactWhere,
  normalizeSegmentFilters,
  segmentRequiresOptOutWarning,
} from './segment-filters.util';

describe('normalizeSegmentFilters', () => {
  it('cria segmento com criterios normalizados', () => {
    const filters = normalizeSegmentFilters({
      tagIds: [' tag-1 ', 'tag-1', 'tag-2'],
      status: ContactStatus.ACTIVE,
      channel: ChannelType.WHATSAPP,
    });

    assert.deepEqual(filters.tagIds, ['tag-1', 'tag-2']);
    assert.equal(filters.status, ContactStatus.ACTIVE);
    assert.equal(filters.includeOptOut, false);
    assert.equal(filters.channel, ChannelType.WHATSAPP);
  });

  it('nunca aceita ContactStatus.DELETED como criterio de status', () => {
    const filters = normalizeSegmentFilters({
      status: ContactStatus.DELETED,
    });
    assert.equal(filters.status, null);
  });
});

describe('buildSegmentContactWhere', () => {
  it('calcula previa excluindo DELETED', () => {
    const where = buildSegmentContactWhere('org-1', 'camp-1', {
      tagIds: ['tag-1'],
      status: null,
      includeOptOut: false,
      channel: null,
    });

    const and = (where as { AND: unknown[] }).AND;
    assert.ok(JSON.stringify(and).includes('DELETED'));
    assert.ok(
      and.some(
        (clause) =>
          typeof clause === 'object' &&
          clause !== null &&
          'tags' in clause,
      ),
    );
  });

  it('exclui opt-out/BLOCKED por padrao', () => {
    const where = buildSegmentContactWhere('org-1', 'camp-1', {
      tagIds: [],
      status: null,
      includeOptOut: false,
      channel: null,
    });

    assert.ok(JSON.stringify(where).includes('BLOCKED'));
    assert.ok(JSON.stringify(where).includes('OPT_OUT'));
  });

  it('permite incluir opt-out apenas com flag explicita', () => {
    const where = buildSegmentContactWhere('org-1', 'camp-1', {
      tagIds: [],
      status: null,
      includeOptOut: true,
      channel: null,
    });

    assert.equal(segmentRequiresOptOutWarning({
      tagIds: [],
      status: null,
      includeOptOut: true,
      channel: null,
    }), true);
    assert.equal(JSON.stringify(where).includes('optOuts'), false);
  });
});
