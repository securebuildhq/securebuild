/**
 * Shared HTTP client for integration tests.
 *
 * Makes real HTTP requests against a local Next.js server (Testcontainers
 * stack). No module mocking — mirrors the Go integration tests in
 * integration/ociproxy.
 */

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  data: unknown;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  async get(path: string): Promise<HttpResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    });
    return this.toResponse(res);
  }

  async getNoAuth(path: string): Promise<HttpResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
    });
    return this.toResponse(res);
  }

  async post(path: string, body?: unknown): Promise<HttpResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.toResponse(res);
  }

  async postNoAuth(path: string, body?: unknown): Promise<HttpResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return this.toResponse(res);
  }

  private async toResponse(res: globalThis.Response): Promise<HttpResponse> {
    const text = await res.text();
    let data: unknown = text;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json') && text) {
      try {
        data = JSON.parse(text);
      } catch {
        // keep raw text
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      data,
    };
  }
}
