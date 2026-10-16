// Offline review state. No network, automatic decisions or website writes.
const choices = new Set(['', 'different_specimens', 'same_specimen', 'uncertain']);
const pairKey = pair => `${pair.first}\n${pair.second}`;

export function blankDecisions(audit) {
  return audit.pairs.map(({ first, second }) => ({ first, second, decision: '' }));
}

export function progress(decisions, acknowledged) {
  const answered = decisions.filter(pair => pair.decision !== '').length;
  const corrections = decisions.filter(pair => ['same_specimen', 'uncertain'].includes(pair.decision)).length;
  return { answered, corrections, ready: Boolean(acknowledged) && decisions.every(pair => pair.decision === 'different_specimens') };
}

export function reviewDocument(audit, decisions, acknowledged, reviewedAt = new Date().toISOString()) {
  const result = {
    format: 'folium-photo-pair-review', version: 1, auditId: audit.auditId, purpose: audit.purpose,
    reviewedAt, acknowledged: Boolean(acknowledged), pairs: decisions.map(pair => ({ ...pair })),
  };
  readReview(audit, result); // Check downloaded drafts as strictly as imported ones.
  return result;
}

export function readReview(audit, value) {
  if (!value || value.format !== 'folium-photo-pair-review' || value.version !== 1 ||
      value.auditId !== audit.auditId || value.purpose !== audit.purpose || typeof value.acknowledged !== 'boolean' ||
      typeof value.reviewedAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value.reviewedAt) ||
      !Number.isFinite(Date.parse(value.reviewedAt)) || !Array.isArray(value.pairs) || value.pairs.length !== audit.pairs.length) {
    throw new Error('Invalid review or dataset identity');
  }
  const expected = new Map(audit.pairs.map(pair => [pairKey(pair), pair]));
  const decisions = new Map();
  for (const pair of value.pairs) {
    if (!pair || typeof pair.first !== 'string' || typeof pair.second !== 'string' ||
        !choices.has(pair.decision) || !expected.has(pairKey(pair)) || decisions.has(pairKey(pair))) {
      throw new Error('Unknown, repeated or invalid pair');
    }
    decisions.set(pairKey(pair), pair.decision);
  }
  return { acknowledged: value.acknowledged,
    pairs: audit.pairs.map(({ first, second }) => ({ first, second, decision: decisions.get(pairKey({ first, second })) })) };
}

export function mount(doc) {
  const source = doc.getElementById('review-data');
  if (!source) return;
  const audit = JSON.parse(source.textContent);
  const text = audit.copy;
  let decisions = blankDecisions(audit);
  const ack = doc.getElementById('acknowledged');
  const status = doc.getElementById('review-status');
  const message = doc.getElementById('review-message');
  const save = doc.getElementById('save-review');
  const input = doc.getElementById('load-review');
  const selectors = [...doc.querySelectorAll('[data-pair-index]')];
  function update() {
    const state = progress(decisions, ack.checked);
    const final = audit.blocked ? text.blocked : state.ready ? text.ready : text.pending;
    status.textContent = `${text.progress}: ${state.answered}/${decisions.length}. ${text.corrections}: ${state.corrections}. ${final}`;
  }
  for (const select of selectors) select.addEventListener('change', () => {
    decisions[Number(select.dataset.pairIndex)].decision = select.value;
    // A changed decision needs a fresh acknowledgement.
    ack.checked = false;
    message.textContent = '';
    update();
  });
  ack.addEventListener('change', update);
  save.addEventListener('click', () => {
    const value = reviewDocument(audit, decisions, ack.checked);
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = `folium-pair-review-${audit.auditId.slice(0, 12)}.json`;
    doc.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = text.downloaded;
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Review too large');
      const parsed = readReview(audit, JSON.parse(await file.text()));
      decisions = parsed.pairs;
      ack.checked = parsed.acknowledged;
      for (const select of selectors) select.value = decisions[Number(select.dataset.pairIndex)].decision;
      message.textContent = text.loaded;
      update();
    } catch {
      message.textContent = text.bad_review;
    } finally { input.value = ''; }
  });
  save.disabled = false;
  input.disabled = false;
  update();
}

if (typeof document !== 'undefined') mount(document);
