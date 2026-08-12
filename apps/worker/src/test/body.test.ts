import { describe, expect, it } from 'vitest';
import { ApiError } from '../http/api-error.js';
import { readBytes } from '../http/body.js';

describe('leitura limitada de payload binário', () => {
  it('lê o corpo sem depender de Content-Length', async () => {
    const request = new Request('https://quiz.test/upload', {
      body: new Uint8Array([1, 2, 3]),
      method: 'POST',
    });

    expect(new Uint8Array(await readBytes(request, 3))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('cancela a leitura assim que o hard cap é ultrapassado', async () => {
    const request = new Request('https://quiz.test/upload', {
      body: new Uint8Array([1, 2, 3]),
      method: 'POST',
    });
    const error = new ApiError(413, 'ARTWORK_TOO_LARGE', 'Imagem grande demais.');

    await expect(readBytes(request, 2, error)).rejects.toMatchObject({
      code: 'ARTWORK_TOO_LARGE',
      status: 413,
    });
  });
});
