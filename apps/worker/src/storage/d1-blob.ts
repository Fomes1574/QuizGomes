/**
 * O binding de produção do D1 materializa BLOBs como `number[]`, enquanto o
 * Miniflare usado nos testes locais pode devolvê-los como `ArrayBuffer`.
 * Normalizamos os dois formatos antes de expor bytes em uma `Response`.
 */
export function d1BlobToArrayBuffer(value: unknown, expectedByteLength: number): ArrayBuffer | null {
  if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1) return null;

  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else if (Array.isArray(value)) {
    if (!value.every((byte) => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return null;
    }
    bytes = Uint8Array.from(value);
  } else {
    return null;
  }

  if (bytes.byteLength !== expectedByteLength) return null;
  // Uma cópia própria evita depender do formato/ownership devolvido pelo D1.
  return bytes.slice().buffer;
}
