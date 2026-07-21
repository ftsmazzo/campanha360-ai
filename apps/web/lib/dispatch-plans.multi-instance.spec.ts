import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hasMultiInstanceCapacityDeficit,
  resolveMultiInstanceConsolidated,
} from './dispatch-plans';

describe('resolveMultiInstanceConsolidated', () => {
  it('prioriza validationSnapshot.multiInstance com shape de validacao', () => {
    const result = resolveMultiInstanceConsolidated({
      validationSnapshot: {
        multiInstance: {
          selectedInstances: 2,
          eligibleInstances: 2,
          blockedInstances: 0,
          totalCapacity: 220,
          totalEligibleAudience: 3,
          capacityDeficit: 0,
          unassignedRecipients: 0,
          passed: true,
          channels: [],
          distribution: [],
        },
        checks: [],
      },
      simulationSnapshot: {
        multiInstance: {
          totalAudience: 3,
          totalCapacity: 220,
          totalAssigned: 3,
          totalUnassigned: 0,
          combinedThroughput: 1,
          estimatedOverallEndAt: null,
          activeInstances: 2,
          blockedInstances: 0,
        },
      },
    });

    assert.equal(result?.eligibleInstances, 2);
    assert.equal(result?.selectedInstances, 2);
    assert.equal(result?.totalEligibleAudience, 3);
    assert.equal(result?.capacityDeficit, 0);
    assert.equal(result?.passed, true);
  });

  it('nao usa campos de simulacao crus como consolidado de validacao', () => {
    const result = resolveMultiInstanceConsolidated({
      validationSnapshot: null,
      approvalSnapshot: null,
      simulationSnapshot: {
        multiInstance: {
          totalAudience: 3,
          totalCapacity: 220,
          totalAssigned: 3,
          totalUnassigned: 0,
          combinedThroughput: 1,
          estimatedOverallEndAt: null,
          activeInstances: 2,
          blockedInstances: 0,
        },
      },
    });

    assert.ok(result);
    assert.equal(result.totalEligibleAudience, 3);
    assert.equal(result.eligibleInstances, 2);
    assert.equal(result.selectedInstances, 2);
    assert.equal(result.capacityDeficit, 0);
    assert.equal(result.unassignedRecipients, 0);
    assert.equal(result.passed, true);
  });

  it('alerta de deficit so com number > 0', () => {
    assert.equal(hasMultiInstanceCapacityDeficit(undefined), false);
    assert.equal(hasMultiInstanceCapacityDeficit(null), false);
    assert.equal(hasMultiInstanceCapacityDeficit(0), false);
    assert.equal(hasMultiInstanceCapacityDeficit(''), false);
    assert.equal(hasMultiInstanceCapacityDeficit(1), true);
  });
});
