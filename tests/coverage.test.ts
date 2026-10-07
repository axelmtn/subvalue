import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPricingCoverage } from '../packages/core/src/coverage.ts';

test('only completely priced usage displays 100%', () => {
  assert.equal(formatPricingCoverage(1), '100%');
  assert.equal(formatPricingCoverage(199 / 200), '<100%');
  assert.equal(formatPricingCoverage(1 - Number.EPSILON), '<100%');
  assert.equal(formatPricingCoverage(0.94), '94%');
});

test('unknown coverage and small positive coverage remain distinct from zero', () => {
  assert.equal(formatPricingCoverage(null), 'Unknown');
  assert.equal(formatPricingCoverage(NaN), 'Unknown');
  assert.equal(formatPricingCoverage(Infinity), 'Unknown');
  assert.equal(formatPricingCoverage(-0.1), 'Unknown');
  assert.equal(formatPricingCoverage(1.1), 'Unknown');
  assert.equal(formatPricingCoverage(0), '0%');
  assert.equal(formatPricingCoverage(0.001), '<1%');
});
