/**
 * The sixteen endpoints of spec chapter 15, as served and as documented.
 *
 * This table is the acceptance reference: `test/api/openapi.test.ts` checks that
 * the OpenAPI document exposes exactly these operations, and that the router
 * serves each of them. `GET /v1/validations?status=pending` is the documented
 * form of `GET /v1/validations` (the query parameter carries the status).
 */

/** One endpoint of chapter 15. */
export interface ChapterEndpoint {
  method: 'GET' | 'POST' | 'PUT';
  /** OpenAPI path template, `{id}` style. */
  path: string;
  /** Requirement reference from the specification. */
  requirement: string;
}

/** The sixteen endpoints of chapter 15, in specification order. */
export const CHAPTER_15_ENDPOINTS: readonly ChapterEndpoint[] = [
  { method: 'POST', path: '/v1/frameworks', requirement: 'EF-REF-01' },
  { method: 'GET', path: '/v1/frameworks', requirement: 'EF-REF-02' },
  { method: 'GET', path: '/v1/frameworks/{id}/controls', requirement: 'EF-REF-01' },
  { method: 'GET', path: '/v1/frameworks/{id}/readiness', requirement: 'EF-FRA-03' },
  { method: 'POST', path: '/v1/evidence', requirement: 'EF-COL-02' },
  { method: 'GET', path: '/v1/evidence/{id}', requirement: 'EF-LEC-03' },
  { method: 'GET', path: '/v1/controls/{id}', requirement: 'EF-FRA-02' },
  { method: 'GET', path: '/v1/controls/{id}/evidence', requirement: 'EF-RAT-02' },
  { method: 'GET', path: '/v1/validations', requirement: 'EF-VAL-01' },
  { method: 'POST', path: '/v1/validations/{id}/decision', requirement: 'EF-VAL-02' },
  { method: 'POST', path: '/v1/ask', requirement: 'EF-QR-01' },
  { method: 'POST', path: '/v1/frameworks/{id}/packs', requirement: 'EF-DOS-01' },
  { method: 'GET', path: '/v1/packs/{id}', requirement: 'EF-DOS-02' },
  { method: 'GET', path: '/v1/reminders', requirement: 'EF-REL-01' },
  { method: 'POST', path: '/v1/controls/{id}/remind', requirement: 'EF-REL-01' },
  { method: 'GET', path: '/v1/audit-log', requirement: 'EF-ADM-02' }
];

/** The same list as `METHOD /path` strings, for assertions and logs. */
export const CHAPTER_15_OPERATIONS: readonly string[] = CHAPTER_15_ENDPOINTS.map(
  (endpoint) => `${endpoint.method} ${endpoint.path}`
);
