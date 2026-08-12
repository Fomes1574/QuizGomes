import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, apiUpload } from '../lib/api.js';

function apiErrorResponse(): Response {
  return Response.json({ error: { code: 'INVALID_TOKEN', message: 'A sessão expirou ou é inválida.' } }, {
    status: 401,
  });
}

describe('cliente HTTP autenticado', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('força getIdToken(true) e repete exatamente uma vez após 401', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(apiErrorResponse())
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const getToken = vi.fn().mockResolvedValue('token-renovado');
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ ok: boolean }>('/api/profile/me', {
      getToken,
      token: 'token-em-cache',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith(true);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer token-em-cache');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer token-renovado');
  });

  it('encerra com erro claro após o segundo 401 sem entrar em loop', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(apiErrorResponse())
      .mockResolvedValueOnce(apiErrorResponse());
    const getToken = vi.fn().mockResolvedValue('token-renovado');
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/profile/me', {
      getToken,
      token: 'token-em-cache',
    })).rejects.toMatchObject({
      code: 'AUTH_RETRY_FAILED',
      message: 'Não foi possível renovar sua sessão. Saia e entre novamente.',
      status: 401,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('envia upload binário sem converter a imagem para JSON e preserva If-Match no retry', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(apiErrorResponse())
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const getToken = vi.fn().mockResolvedValue('token-renovado');
    const image = new Blob(['webp-sintetico'], { type: 'image/webp' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiUpload<{ ok: boolean }>('/api/admin/themes/theme/artwork', {
      body: image,
      getToken,
      headers: { 'If-Match': '3' },
      method: 'PUT',
      token: 'token-em-cache',
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(image);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(image);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Content-Type')).toBe('image/webp');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('If-Match')).toBe('3');
  });
});
