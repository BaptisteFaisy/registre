/**
 * Registre portal — API client (spec chapter 15, 16 endpoints).
 *
 * The portal never talks to AWS directly: it calls the Registre API, which
 * owns the Bedrock calls, the state engine and the audit trail. The same
 * interface is implemented by the offline mock client (`src/mocks/client.ts`),
 * so every screen runs with or without a backend.
 */

import type {
  Answer,
  AuditEvent,
  Control,
  ControlWithRelations,
  Evidence,
  EvidenceUploadInput,
  Framework,
  FrameworkImport,
  Pack,
  ReadinessOverview,
  Reminder,
  Settings,
  ValidationDecision,
  ValidationItem
} from './types.ts';
import { buildEvidencePayload } from './evidencePayload.ts';

/** HTTP failure surfaced to the screens. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  /** True when the session is no longer valid and the user must sign in. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Every call the portal can make. Mocks and HTTP implement the same list. */
export interface RegistreApi {
  /* frameworks and controls */
  listFrameworks(): Promise<Framework[]>;
  importFramework(payload: FrameworkImport): Promise<Framework>;
  listControls(frameworkId: string): Promise<Control[]>;
  getReadiness(frameworkId: string): Promise<ReadinessOverview>;

  /* evidence */
  uploadEvidence(input: EvidenceUploadInput): Promise<Evidence>;
  getEvidence(evidenceId: string): Promise<Evidence>;

  /* controls */
  getControl(controlId: string): Promise<ControlWithRelations>;
  listControlEvidence(controlId: string): Promise<Evidence[]>;

  /* validation */
  listValidations(status?: 'PENDING' | 'DECIDED'): Promise<ValidationItem[]>;
  decideValidation(
    validationId: string,
    decision: ValidationDecision,
    note: string
  ): Promise<ValidationItem>;

  /* questions and answers */
  ask(question: string): Promise<Answer>;

  /* audit packs */
  createPack(frameworkId: string): Promise<Pack>;
  getPack(packId: string): Promise<Pack>;
  listPacks(frameworkId?: string): Promise<Pack[]>;

  /* reminders */
  listReminders(): Promise<Reminder[]>;
  sendReminder(controlId: string): Promise<Reminder>;

  /* audit trail */
  listAuditLog(filter?: { limit?: number; action?: string }): Promise<AuditEvent[]>;

  /* settings (extension of chapter 15, required by EF-ADM-01) */
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
}

/** Injected by the session layer so every call carries the bearer token. */
export interface TokenProvider {
  token(): string | null;
}

export interface HttpClientOptions {
  baseUrl: string;
  tokens?: TokenProvider;
  fetchImpl?: typeof fetch;
  /**
   * Called when the API answers 401: the session is over and the portal must
   * drop back to the sign-in screen.
   */
  onUnauthorized?: () => void;
}

/** Thin JSON client over `fetch`, with HTTP status mapping (chapter 15). */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly tokens: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly onUnauthorized: (() => void) | undefined;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.tokens = options.tokens ?? { token: () => null };
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onUnauthorized = options.onUnauthorized;
  }

  /** Performs one call and unwraps the JSON body. */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init)
    });
    return this.unwrap<T>(response);
  }

  /**
   * Request headers. Typed as a plain record instead of the DOM `HeadersInit`
   * so this module also compiles under the repository-root tsconfig, which has
   * no DOM lib (the contract test imports it from Node).
   */
  private headers(init: RequestInit): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body) headers['Content-Type'] = 'application/json';
    const token = this.tokens.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  /** Maps a non-2xx response to `ApiError` with the backend error code. */
  private async unwrap<T>(response: Response): Promise<T> {
    const text = await response.text();
    const payload = text ? safeParse(text) : null;
    if (!response.ok) {
      if (response.status === 401) this.onUnauthorized?.();
      throw toApiError(response.status, payload);
    }
    return payload as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Builds an `ApiError` from an HTTP status and an optional error payload. */
function toApiError(status: number, payload: unknown): ApiError {
  const body = (payload ?? {}) as { code?: string; message?: string; error?: string; detail?: unknown };
  const message = body.message ?? body.error ?? `Request failed with status ${status}`;
  return new ApiError(status, body.code ?? defaultCode(status), message, body.detail);
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNREADABLE';
    default:
      return 'UPSTREAM';
  }
}

/** HTTP implementation of the 16 chapter 15 endpoints. */
export class HttpRegistreApi implements RegistreApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions) {
    this.http = new HttpClient(options);
  }

  listFrameworks(): Promise<Framework[]> {
    return this.http.request<Framework[]>('/v1/frameworks');
  }

  importFramework(payload: FrameworkImport): Promise<Framework> {
    return this.http.request<Framework>('/v1/frameworks', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  listControls(frameworkId: string): Promise<Control[]> {
    return this.http.request<Control[]>(`/v1/frameworks/${encodeURIComponent(frameworkId)}/controls`);
  }

  getReadiness(frameworkId: string): Promise<ReadinessOverview> {
    return this.http.request<ReadinessOverview>(`/v1/frameworks/${encodeURIComponent(frameworkId)}/readiness`);
  }

  uploadEvidence(input: EvidenceUploadInput): Promise<Evidence> {
    return this.http.request<Evidence>('/v1/evidence', {
      method: 'POST',
      body: JSON.stringify(buildEvidencePayload(input))
    });
  }

  getEvidence(evidenceId: string): Promise<Evidence> {
    return this.http.request<Evidence>(`/v1/evidence/${encodeURIComponent(evidenceId)}`);
  }

  getControl(controlId: string): Promise<ControlWithRelations> {
    return this.http.request<ControlWithRelations>(`/v1/controls/${encodeURIComponent(controlId)}`);
  }

  listControlEvidence(controlId: string): Promise<Evidence[]> {
    return this.http.request<Evidence[]>(`/v1/controls/${encodeURIComponent(controlId)}/evidence`);
  }

  listValidations(status?: 'PENDING' | 'DECIDED'): Promise<ValidationItem[]> {
    const query = status ? `?status=${status.toLowerCase()}` : '';
    return this.http.request<ValidationItem[]>(`/v1/validations${query}`);
  }

  decideValidation(
    validationId: string,
    decision: ValidationDecision,
    note: string
  ): Promise<ValidationItem> {
    return this.http.request<ValidationItem>(
      `/v1/validations/${encodeURIComponent(validationId)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision, note }) }
    );
  }

  ask(question: string): Promise<Answer> {
    return this.http.request<Answer>('/v1/ask', {
      method: 'POST',
      body: JSON.stringify({ question })
    });
  }

  createPack(frameworkId: string): Promise<Pack> {
    return this.http.request<Pack>(`/v1/frameworks/${encodeURIComponent(frameworkId)}/packs`, {
      method: 'POST'
    });
  }

  getPack(packId: string): Promise<Pack> {
    return this.http.request<Pack>(`/v1/packs/${encodeURIComponent(packId)}`);
  }

  listPacks(frameworkId?: string): Promise<Pack[]> {
    const query = frameworkId ? `?frameworkId=${encodeURIComponent(frameworkId)}` : '';
    return this.http.request<Pack[]>(`/v1/packs${query}`);
  }

  listReminders(): Promise<Reminder[]> {
    return this.http.request<Reminder[]>('/v1/reminders');
  }

  sendReminder(controlId: string): Promise<Reminder> {
    return this.http.request<Reminder>(`/v1/controls/${encodeURIComponent(controlId)}/remind`, {
      method: 'POST'
    });
  }

  listAuditLog(filter?: { limit?: number; action?: string }): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (filter?.limit) params.set('limit', String(filter.limit));
    if (filter?.action) params.set('action', filter.action);
    const query = params.toString();
    return this.http.request<AuditEvent[]>(`/v1/audit-log${query ? `?${query}` : ''}`);
  }

  getSettings(): Promise<Settings> {
    return this.http.request<Settings>('/v1/settings');
  }

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.http.request<Settings>('/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    });
  }
}
