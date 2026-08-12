import { ApiError } from './api-error.js';

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.googleusercontent.com",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://securetoken.googleapis.com wss:",
    "frame-src 'self' https://accounts.google.com https://quizgomes-cbc48.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } },
      { status: error.status },
    );
  }
  console.error('Unhandled API error', error instanceof Error ? error.message : 'unknown');
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' } }, { status: 500 });
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) headers.set(name, value);
  return rebuild(response, headers);
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.origin === 'null'
      || url.username !== ''
      || url.password !== ''
      || url.pathname !== '/'
      || url.search !== ''
      || url.hash !== ''
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isRequestOriginAllowed(request: Request, allowedOrigins?: string): boolean {
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin === null) return true;
  const normalizedRequestOrigin = normalizedOrigin(requestOrigin);
  if (normalizedRequestOrigin === null) return false;
  if (normalizedRequestOrigin === new URL(request.url).origin) return true;
  const allowed = (allowedOrigins ?? '')
    .split(',')
    .map((value) => normalizedOrigin(value.trim()))
    .filter((value): value is string => value !== null);
  return allowed.includes(normalizedRequestOrigin);
}

export function corsHeaders(request: Request, allowedOrigins?: string): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  if (origin !== null && isRequestOriginAllowed(request, allowedOrigins)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, If-Match');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Max-Age', '600');
  return headers;
}

export function applyCors(response: Response, request: Request, allowedOrigins?: string): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request, allowedOrigins).forEach((value, name) => headers.set(name, value));
  return rebuild(response, headers);
}

function rebuild(response: Response, headers: Headers): Response {
  if (response.status === 101 && response.webSocket !== null) {
    return new Response(null, { headers, status: 101, webSocket: response.webSocket });
  }
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}
