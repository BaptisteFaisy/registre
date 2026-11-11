/**
 * Shared fixtures of the API suite: one well-formed framework import and one
 * well-formed text evidence, so every test starts from a realistic payload.
 */

import type { Evidence } from '../../src/domain/types.ts';
import { evidenceId } from '../../src/support/ids.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { makeEvidence, makeFrameworkImport } from '../fixtures/builders.ts';
import { TOKENS } from './harness.ts';
import type { TestApi, TestResponse } from './harness.ts';

/** Text evidence body understood by the scripted reader (header block + body). */
export function policyText(): string {
  return [
    '---',
    'Title: Information security policy',
    'Type: Policy',
    'Date: 2026-08-01',
    'Version: 3.1',
    'Author: A. Dupont',
    'Approved by: C. Bernard',
    'Approval date: 2026-08-05',
    'Personal data: no',
    'Summary: Annual review of the information security policy approved by the steering committee.',
    '---',
    'The information security policy was reviewed on 1 August 2026 and approved by C. Bernard.',
    'The next review is due within twelve months.'
  ].join('\n');
}

/** Bytes of the fixture policy. */
export function policyBytes(): Uint8Array {
  return new TextEncoder().encode(policyText());
}

/** Id the pipeline derives for the fixture policy (deterministic). */
export function policyEvidenceId(): string {
  return evidenceId(sha256Bytes(policyBytes()));
}

/** A catalogue entry matching the ingested fixture, so retrieval can find it. */
export function policyCatalogEntry(overrides: Partial<Evidence> = {}): Evidence {
  return makeEvidence({
    id: policyEvidenceId(),
    sha256: sha256Bytes(policyBytes()),
    contentType: 'text/plain',
    textPages: [{ page: 1, text: policyText() }],
    ...overrides
  });
}

/** Import payload with two controls: one annual policy, one quarterly restore test. */
export function frameworkPayload() {
  return makeFrameworkImport(
    [
      {
        id: 'CONT-01',
        domain: 'Governance',
        title: 'Information security policy reviewed annually',
        requirement: 'The information security policy is reviewed and approved at least once a year.',
        expectedEvidence: ['Policy title', 'Review date', 'Approver name', 'Version'],
        periodicity: 'P1Y',
        owner: 'quality.lead',
        mandatory: true
      },
      {
        id: 'CONT-03',
        domain: 'Continuity',
        title: 'Backup restore test',
        requirement: 'Backups of managed environments are tested by a real restore at a defined interval.',
        expectedEvidence: ['Test date', 'Restored data set', 'Measured recovery time', 'Signatory name'],
        periodicity: 'P3M',
        owner: 'ops.lead',
        mandatory: true
      }
    ],
    { id: 'demo-msp', name: 'Demonstration MSP framework', version: '1.0' }
  );
}

/** Imports the fixture framework through the API, as the demo script does. */
export async function importDemoFramework(api: TestApi): Promise<TestResponse> {
  return api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: frameworkPayload() });
}

/** Deposits the fixture policy as base64 JSON and returns the response. */
export async function depositPolicy(api: TestApi, controlId = 'CONT-01'): Promise<TestResponse> {
  return api.request('POST', '/v1/evidence', {
    token: TOKENS.qualityLead,
    body: {
      filename: 'policy.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.from(policyBytes()).toString('base64'),
      controlId
    }
  });
}

/** Id of the evidence carried by a deposit or a read response (bare `Evidence`). */
export function evidenceIdOf(response: TestResponse): string {
  const id = (response.json as { id?: unknown }).id;
  if (typeof id !== 'string') {
    throw new Error(`the response carries no evidence id: ${response.text.slice(0, 200)}`);
  }
  return id;
}

/** Opens a demonstration session (EF-ADM-03); the route is public. */
export async function openSession(api: TestApi, login: string, password: string): Promise<TestResponse> {
  return api.request('POST', '/v1/auth/session', { token: null, body: { login, password } });
}

/** Text of a restricted evidence: personal data, so the level is RESTRICTED. */
export function restrictedText(): string {
  return [
    '---',
    'Title: Training attendance',
    'Type: List',
    'Date: 2026-09-01',
    'Author: HR team',
    'Personal data: yes',
    'Summary: Attendance list of the security training, with staff e-mails.',
    '---',
    'Alice alice@msp.demo attended the security training on 1 September 2026.'
  ].join('\n');
}

/** Deposits the restricted fixture and returns the response. */
export async function depositRestricted(api: TestApi): Promise<TestResponse> {
  return api.request('POST', '/v1/evidence', {
    token: TOKENS.qualityLead,
    body: {
      filename: 'training.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.from(new TextEncoder().encode(restrictedText())).toString('base64')
    }
  });
}
