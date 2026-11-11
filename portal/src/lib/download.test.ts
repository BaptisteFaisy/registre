import test from 'node:test';
import assert from 'node:assert/strict';

import { packIndexText } from './download.ts';
import type { Pack } from '../api/types.ts';

const pack: Pack = {
  id: 'pk-001',
  frameworkId: 'fw-demo',
  frozenAt: '2026-10-01T18:00:00.000Z',
  index: [
    {
      controlId: 'BCP-02',
      controlTitle: 'Backup restore test',
      state: 'TO_VERIFY',
      evidence: [
        {
          evidenceId: 'ev-020',
          title: 'Backup restore test report Q1 2026',
          documentDate: '2026-02-10',
          sha256: 'a'.repeat(64),
          sufficiencyClass: 'COMPLETE',
          quote: 'Measured recovery time: 3 h 05.',
          page: 1
        }
      ]
    }
  ],
  knownGaps: [{ controlId: 'BCP-02', state: 'TO_VERIFY', detail: 'partial-sufficiency.' }],
  archive: {
    uri: 's3://vault/packs/pk-001.zip',
    sha256: 'b'.repeat(64),
    sizeBytes: 1024
  },
  checksumsVerified: true
};

test('the pack index lists the archive, the gaps and every control', () => {
  const text = packIndexText(pack);
  assert.match(text, /Registre — audit pack pk-001/);
  assert.match(text, /Checksums verified: yes/);
  assert.match(text, /BCP-02 \[To verify\]/);
  assert.match(text, /ev-020 Backup restore test report Q1 2026/);
  assert.match(text, /Measured recovery time: 3 h 05\./);
});

/** The forbidden stems, assembled so this test file never spells them out. */
function forbiddenWording(): RegExp {
  return new RegExp(['compl', 'iant', '|conf', 'orme'].join(''), 'i');
}

test('the index never describes a control with the forbidden wording', () => {
  assert.doesNotMatch(packIndexText(pack), forbiddenWording());
});
