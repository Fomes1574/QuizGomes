import { describe, expect, it } from 'vitest';
import { d1BlobToArrayBuffer } from '../storage/d1-blob.js';

describe('normalização de BLOB do D1', () => {
  it('converte o array de bytes devolvido pelo binding remoto em ArrayBuffer', () => {
    const data = d1BlobToArrayBuffer([0x52, 0x49, 0x46, 0x46], 4);
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(data ?? new ArrayBuffer(0)))).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it('preserva ArrayBuffer e rejeita BLOB inconsistente ou corrompido', () => {
    expect(Array.from(new Uint8Array(d1BlobToArrayBuffer(new Uint8Array([1, 2, 3]).buffer, 3) ?? new ArrayBuffer(0))))
      .toEqual([1, 2, 3]);
    expect(d1BlobToArrayBuffer([1, 2], 3)).toBeNull();
    expect(d1BlobToArrayBuffer([1, 256], 2)).toBeNull();
    expect(d1BlobToArrayBuffer('not-a-blob', 1)).toBeNull();
  });
});
