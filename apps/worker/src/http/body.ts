import { ApiError } from './api-error.js';

const MAX_JSON_BYTES = 256 * 1024;

export async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é muito grande.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'O conteúdo enviado é muito grande.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'O JSON enviado é inválido.');
  }
}
