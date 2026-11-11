/**
 * Test support for the HTTP clients: it records what `fetch` was asked to do
 * and answers a canned response, so the request shape can be asserted without
 * a server, a DOM or a bundler. Only the `*.test.ts` files import it.
 */

/** One call captured by the stub. */
export interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** The stubbed `fetch` and what it saw. */
export interface FetchStub {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
  /** The first captured call, asserted to exist. */
  only(): CapturedCall;
  /** The body of the first call, parsed as JSON. */
  onlyBody(): Record<string, unknown>;
}

/** Answers a fixed response, or one chosen per call. */
export type FetchResponder = Response | ((call: CapturedCall) => Response);

/** Builds a stubbed `fetch` that records every call. */
export function stubFetch(respond: FetchResponder): FetchStub {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: CapturedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as unknown as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? init.body : ''
    };
    calls.push(call);
    return typeof respond === 'function' ? respond(call) : respond;
  }) as unknown as typeof fetch;

  const stub: FetchStub = {
    fetchImpl,
    calls,
    only(): CapturedCall {
      const call = calls[0];
      if (!call) throw new Error('The stubbed fetch was never called.');
      return call;
    },
    onlyBody(): Record<string, unknown> {
      return JSON.parse(stub.only().body) as Record<string, unknown>;
    }
  };
  return stub;
}

/** A JSON answer with the given status. */
export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
