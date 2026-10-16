import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDecisions, progress, reviewDocument, readReview, mount } from '../folium_ml/inspection_ui.mjs';

const audit = { auditId: 'a'.repeat(64), purpose: 'synthetic-smoke-test',
  pairs: [{ first: 'photo-a', second: 'photo-b' }, { first: 'photo-a', second: 'photo-c' }],
  copy: Object.fromEntries(['progress', 'corrections', 'ready', 'pending', 'blocked', 'downloaded', 'loaded', 'bad_review'].map(key => [key, key])) };
const date = '2026-10-16T12:00:00Z';

test('decisions start unanswered and cannot declare readiness with doubts or without acknowledgement', () => {
  const decisions = blankDecisions(audit);
  assert.deepEqual(progress(decisions, false), { answered: 0, corrections: 0, ready: false });
  decisions[0].decision = 'uncertain';
  decisions[1].decision = 'same_specimen';
  assert.deepEqual(progress(decisions, true), { answered: 2, corrections: 2, ready: false });
  decisions.forEach(pair => { pair.decision = 'different_specimens'; });
  assert.equal(progress(decisions, false).ready, false);
  assert.equal(progress(decisions, true).ready, true);
});

test('draft and complete reviews round-trip without modifying original state', () => {
  const decisions = blankDecisions(audit);
  decisions[0].decision = 'different_specimens';
  for (const acknowledged of [false, true]) {
    const value = reviewDocument(audit, decisions, acknowledged, date);
    const restored = readReview(audit, JSON.parse(JSON.stringify(value)));
    assert.deepEqual(restored, { acknowledged, pairs: decisions });
    assert.equal(value.purpose, 'synthetic-smoke-test');
    value.pairs[0].decision = 'uncertain';
    assert.equal(decisions[0].decision, 'different_specimens');
  }
});

test('stale, unknown, repeated, missing and malformed decisions cannot be imported', () => {
  const valid = reviewDocument(audit, blankDecisions(audit), false, date);
  const changes = [
    r => { r.auditId = 'b'.repeat(64); }, r => { r.purpose = 'plant-research'; },
    r => { r.acknowledged = 1; }, r => { r.reviewedAt = '2026-10-16'; },
    r => { r.reviewedAt = null; }, r => { r.pairs.pop(); },
    r => { r.pairs[1] = r.pairs[0]; }, r => { r.pairs[0].first = 'other'; },
    r => { r.pairs[0].decision = 'whatever'; }, r => { r.pairs[0] = null; },
  ];
  for (const change of changes) {
    const changed = structuredClone(valid);
    change(changed);
    assert.throws(() => readReview(audit, changed));
  }
  const reversed = structuredClone(valid);
  reversed.pairs.reverse();
  assert.deepEqual(readReview(audit, reversed).pairs, valid.pairs);
});

function fixture() {
  function element() {
    return { checked: false, disabled: true, value: '', textContent: '', handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; } };
  }
  const ids = Object.fromEntries(['review-data', 'acknowledged', 'review-status', 'review-message', 'save-review', 'load-review'].map(id => [id, element()]));
  ids['review-data'].textContent = JSON.stringify(audit);
  const selectors = audit.pairs.map((_, index) => ({ ...element(), dataset: { pairIndex: String(index) } }));
  const doc = { getElementById: id => ids[id], querySelectorAll: () => selectors };
  return { ids, selectors, doc };
}

test('mounted controls restore valid drafts, reject stale imports and reset acknowledgement after edits', async () => {
  const { ids, selectors, doc } = fixture();
  mount(doc);
  assert.equal(ids['save-review'].disabled, false);
  assert.equal(ids['load-review'].disabled, false);
  assert.match(ids['review-status'].textContent, /pending/);
  const decisions = blankDecisions(audit).map(pair => ({ ...pair, decision: 'different_specimens' }));
  const valid = reviewDocument(audit, decisions, true, date);
  ids['load-review'].files = [{ size: 900, text: async () => JSON.stringify(valid) }];
  await ids['load-review'].handlers.change();
  assert.equal(ids.acknowledged.checked, true);
  assert.match(ids['review-status'].textContent, /ready/);
  assert.equal(selectors[0].value, 'different_specimens');
  selectors[0].value = 'uncertain';
  selectors[0].handlers.change();
  assert.equal(ids.acknowledged.checked, false);
  assert.match(ids['review-status'].textContent, /corrections: 1/);
  valid.auditId = 'stale';
  ids['load-review'].files = [{ size: 900, text: async () => JSON.stringify(valid) }];
  await ids['load-review'].handlers.change();
  assert.equal(ids['review-message'].textContent, 'bad_review');
  assert.equal(selectors[0].value, 'uncertain');
});

test('blocked audit never displays ready even after complete imported decisions', async () => {
  const { ids, doc } = fixture();
  ids['review-data'].textContent = JSON.stringify({ ...audit, blocked: true });
  mount(doc);
  const decisions = blankDecisions(audit).map(pair => ({ ...pair, decision: 'different_specimens' }));
  const valid = reviewDocument(audit, decisions, true, date);
  ids['load-review'].files = [{ size: 900, text: async () => JSON.stringify(valid) }];
  await ids['load-review'].handlers.change();
  assert.match(ids['review-status'].textContent, /blocked/);
  assert.doesNotMatch(ids['review-status'].textContent, /ready/);
});
