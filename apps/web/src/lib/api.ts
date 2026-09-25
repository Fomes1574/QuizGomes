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

export interface ApiUploadOptions extends Omit<RequestInit, 'body'> {
  body: Blob;
  getToken?: (forceRefresh: boolean) => Promise<string | null>;
  token?: string | null;
}

export interface ApiDownloadOptions extends Omit<RequestInit, 'body'> {
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

async function responsePayload<T>(response: Response): Promise<T> {
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
  return responsePayload<T>(response);
}

async function sendUpload(
  path: string,
  body: Blob,
  token: string | null | undefined,
  options: Omit<ApiUploadOptions, 'body' | 'getToken' | 'token'>,
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', body.type);
  if (token !== undefined && token !== null) headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...options, body, headers });
}

export async function apiUpload<T>(path: string, options: ApiUploadOptions): Promise<T> {
  const { body, getToken, token, ...requestOptions } = options;
  let currentToken = token;
  if ((currentToken === undefined || currentToken === null) && getToken !== undefined) {
    currentToken = await getToken(false);
  }
  let response = await sendUpload(path, body, currentToken, requestOptions);
  if (response.status === 401 && getToken !== undefined) {
    try {
      currentToken = await getToken(true);
    } catch {
      throw authRetryError();
    }
    if (currentToken === null) throw authRetryError();
    response = await sendUpload(path, body, currentToken, requestOptions);
    if (response.status === 401) throw authRetryError();
  }
  return responsePayload<T>(response);
}

/** Baixa um arquivo autenticado preservando o body binário/stream da resposta. */
export async function apiDownload(path: string, options: ApiDownloadOptions = {}): Promise<Response> {
  const { getToken, token, ...requestOptions } = options;
  let currentToken = token;
  if ((currentToken === undefined || currentToken === null) && getToken !== undefined) {
    currentToken = await getToken(false);
  }
  const download = async (authToken: string | null | undefined): Promise<Response> => {
    const headers = new Headers(requestOptions.headers);
    headers.set('Accept', 'text/csv, application/json');
    if (authToken !== undefined && authToken !== null) headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(path, { ...requestOptions, headers });
  };
  let response = await download(currentToken);
  if (response.status === 401 && getToken !== undefined) {
    try {
      currentToken = await getToken(true);
    } catch {
      throw authRetryError();
    }
    if (currentToken === null) throw authRetryError();
    response = await download(currentToken);
    if (response.status === 401) throw authRetryError();
  }
  if (!response.ok) await responsePayload(response);
  return response;
}

export function websocketUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
