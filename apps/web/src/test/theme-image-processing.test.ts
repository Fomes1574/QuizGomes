// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  processThemeImage,
  THEME_IMAGE_HARD_CAP_BYTES,
  THEME_IMAGE_TARGET_BYTES,
  THEME_IMAGE_TARGET_DIMENSION,
  validateThemeImageFile,
} from '../lib/theme-image-processing.js';

describe('preparação local de imagem do tema', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('bloqueia SVG e tipos fora da lista antes de qualquer upload', () => {
    expect(validateThemeImageFile(new File(['<svg/>'], 'tema.svg', { type: 'image/svg+xml' })))
      .toBe('SVG enviado pelo usuário não é aceito.');
    expect(validateThemeImageFile(new File(['gif'], 'tema.gif', { type: 'image/gif' })))
      .toBe('Escolha uma imagem PNG, JPEG, WebP ou AVIF.');
  });

  it('aceita formatos raster de entrada e mantém targets explícitos', () => {
    expect(validateThemeImageFile(new File(['imagem'], 'tema.png', { type: 'image/png' }))).toBeNull();
    expect(THEME_IMAGE_TARGET_DIMENSION).toBe(512);
    expect(THEME_IMAGE_HARD_CAP_BYTES).toBe(60 * 1_024);
  });

  it('recorta em quadrado, tenta qualidade alta primeiro e para dentro do target', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      const size = (quality ?? 1) <= 0.84 ? 50 * 1_024 : 70 * 1_024;
      callback(new Blob([new Uint8Array(size)], { type: type ?? 'image/webp' }));
    });
    const canvas = {
      getContext: () => ({
        clearRect: vi.fn(),
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
      naturalHeight = 768;
      naturalWidth = 1_024;
      src = '';
      decode = () => Promise.resolve();
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fixture'),
      revokeObjectURL: vi.fn(),
    });

    const result = await processThemeImage(
      new File(['imagem'], 'tema.png', { type: 'image/png' }),
      { offsetX: 0, offsetY: 0, zoom: 1 },
    );

    expect(result.width).toBe(512);
    expect(result.height).toBe(512);
    expect(result.blob.size).toBeLessThanOrEqual(THEME_IMAGE_TARGET_BYTES);
    expect(result.blob.size).toBeLessThanOrEqual(THEME_IMAGE_HARD_CAP_BYTES);
    expect(toBlob.mock.calls.map((call) => call[2])).toEqual([0.92, 0.88, 0.84]);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 128, 0, 768, 768, 0, 0, 512, 512);
  });

  it('continua reduzindo dimensões quando 512 px só atende ao hard cap', async () => {
    const canvas = {
      getContext: () => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
      }),
      height: 0,
      toBlob(this: { width: number }, callback: BlobCallback, type?: string, quality?: number) {
        const reachesTarget = this.width === 448 && (quality ?? 1) <= 0.84;
        const size = reachesTarget ? 50 * 1_024 : 58 * 1_024;
        callback(new Blob([new Uint8Array(size)], { type: type ?? 'image/webp' }));
      },
      width: 0,
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
      tagName === 'canvas' ? canvas : createElement(tagName, options)
    ));
    vi.stubGlobal('Image', class {
      naturalHeight = 768;
      naturalWidth = 1_024;
      src = '';
      decode = () => Promise.resolve();
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fixture'),
      revokeObjectURL: vi.fn(),
    });

    const result = await processThemeImage(
      new File(['imagem'], 'tema.png', { type: 'image/png' }),
      { offsetX: 0, offsetY: 0, zoom: 1 },
    );

    expect(result.width).toBe(448);
    expect(result.blob.size).toBeLessThanOrEqual(THEME_IMAGE_TARGET_BYTES);
  });
});
