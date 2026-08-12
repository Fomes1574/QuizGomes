import { ApiError } from './api-error.js';

const MAX_JSON_BYTES = 256 * 1024;

export async function readBytes(request: Request, maxBytes: number, tooLargeError = new ApiError(
  413,
  'PAYLOAD_TOO_LARGE',
  'O conteúdo enviado é muito grande.',
)): Promise<ArrayBuffer> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw tooLargeError;
  if (request.body === null) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLargeError;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data.buffer;
}

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
