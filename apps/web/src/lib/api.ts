export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ClientApiError';
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  token?: string | null;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, token, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token !== undefined && token !== null) headers.set('Authorization', `Bearer ${token}`);
  const requestInit: RequestInit = { ...requestOptions, headers };
  if (body !== undefined) requestInit.body = JSON.stringify(body);
  const response = await fetch(path, requestInit);
  const payload = await response.json().catch(() => null) as { error?: { code?: string; details?: unknown; message?: string } } | null;
  if (!response.ok) {
    throw new ClientApiError(
      response.status,
      payload?.error?.code ?? 'UNKNOWN_ERROR',
      payload?.error?.message ?? 'Não foi possível concluir a operação.',
      payload?.error?.details,
    );
  }
  return payload as T;
}

export function websocketUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
