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
  getToken?: (forceRefresh: boolean) => Promise<string | null>;
  token?: string | null;
}

const AUTH_RETRY_MESSAGE = 'Não foi possível renovar sua sessão. Saia e entre novamente.';

async function sendRequest(
  path: string,
  body: unknown,
  token: string | null | undefined,
  options: Omit<ApiRequestOptions, 'body' | 'getToken' | 'token'>,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token !== undefined && token !== null) headers.set('Authorization', `Bearer ${token}`);
  const requestInit: RequestInit = { ...options, headers };
  if (body !== undefined) requestInit.body = JSON.stringify(body);
  return fetch(path, requestInit);
}

function authRetryError(): ClientApiError {
  return new ClientApiError(401, 'AUTH_RETRY_FAILED', AUTH_RETRY_MESSAGE);
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, getToken, token, ...requestOptions } = options;
  let currentToken = token;
  if ((currentToken === undefined || currentToken === null) && getToken !== undefined) {
    currentToken = await getToken(false);
  }
  let response = await sendRequest(path, body, currentToken, requestOptions);
  if (response.status === 401 && getToken !== undefined) {
    try {
      currentToken = await getToken(true);
    } catch {
      throw authRetryError();
    }
    if (currentToken === null) throw authRetryError();
    response = await sendRequest(path, body, currentToken, requestOptions);
    if (response.status === 401) throw authRetryError();
  }
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
