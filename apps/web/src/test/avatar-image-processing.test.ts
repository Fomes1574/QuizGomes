// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_DIMENSION,
  AVATAR_HARD_CAP_BYTES,
  AVATAR_TARGET_BYTES,
  processAvatar,
  validateAvatarFile,
} from '../lib/avatar-image-processing.js';

describe('processamento local do avatar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('bloqueia SVG, aceita raster e fixa 256 px/50 KB', () => {
    expect(validateAvatarFile(new File(['<svg/>'], 'avatar.svg', { type: 'image/svg+xml' })))
      .toBe('SVG não é aceito para avatar.');
    expect(validateAvatarFile(new File(['png'], 'avatar.png', { type: 'image/png' }))).toBeNull();
    expect(AVATAR_DIMENSION).toBe(256);
    expect(AVATAR_TARGET_BYTES).toBe(40 * 1_024);
    expect(AVATAR_HARD_CAP_BYTES).toBe(50 * 1_024);
  });

  it('faz crop quadrado e reencoda em WebP dentro do target', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      const size = (quality ?? 1) <= 0.82 ? 38 * 1_024 : 45 * 1_024;
      callback(new Blob([new Uint8Array(size)], { type: type ?? 'image/webp' }));
    });
    const canvas = {
      getContext: () => ({
        drawImage,
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
      }),
      height: 0,
      toBlob,
      width: 0,
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
      tagName === 'canvas' ? canvas : createElement(tagName, options)
    ));
    vi.stubGlobal('Image', class {
      naturalHeight = 600;
      naturalWidth = 900;
      src = '';
      decode = () => Promise.resolve();
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fixture'),
      revokeObjectURL,
    });

    const avatar = await processAvatar(
      new File(['imagem'], 'avatar.jpg', { type: 'image/jpeg' }),
      { offsetX: 0, offsetY: 0, zoom: 1 },
    );

    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(avatar.type).toBe('image/webp');
    expect(avatar.size).toBeLessThanOrEqual(AVATAR_TARGET_BYTES);
    expect(toBlob.mock.calls.map((call) => call[2])).toEqual([0.9, 0.86, 0.82]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 150, 0, 600, 600, 0, 0, 256, 256);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
  });

  it('falha quando nem a menor qualidade respeita o hard cap', async () => {
    const canvas = {
      getContext: () => ({ drawImage: vi.fn(), imageSmoothingEnabled: true, imageSmoothingQuality: 'high' }),
      height: 0,
      toBlob: (callback: BlobCallback) => callback(new Blob([new Uint8Array(51 * 1_024)], { type: 'image/webp' })),
      width: 0,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    vi.stubGlobal('Image', class {
      naturalHeight = 256;
      naturalWidth = 256;
      src = '';
      decode = () => Promise.resolve();
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:fixture', revokeObjectURL: vi.fn() });

    await expect(processAvatar(
      new File(['imagem'], 'avatar.webp', { type: 'image/webp' }),
      { offsetX: 0, offsetY: 0, zoom: 1 },
    )).rejects.toThrow('limite de 50 KB');
  });
});
