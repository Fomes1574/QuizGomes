import { describe, expect, it } from 'vitest';
import { inspectQuestionImageWebp, inspectWebp, QUESTION_IMAGE_MAX_BYTES, THEME_ARTWORK_MAX_BYTES } from '../storage/webp.js';

const SYNTHETIC_512_WEBP = 'UklGRh4CAABXRUJQVlA4IBICAACQOgCdASoAAgACPmEwlkikIyIhIAgAgAwJaW7hd2Ee3AAAE9gHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPWAAA/v+qC//+tTIx9GL//+0s/+pZ/9Sz/FQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function decodeBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer;
}

function withExif(data: ArrayBuffer): ArrayBuffer {
  const source = new Uint8Array(data);
  const output = new Uint8Array(source.length + 12);
  output.set(source);
  output.set([0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 1, 2, 3, 4], source.length);
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return output.buffer;
}

function chunk(kind: string, payload: number[]): number[] {
  const length = payload.length;
  return [
    ...Array.from(kind, (character) => character.charCodeAt(0)),
    length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff,
    ...payload,
    ...(length % 2 === 0 ? [] : [0]),
  ];
}

function withIccProfile(data: ArrayBuffer): ArrayBuffer {
  const source = new Uint8Array(data);
  const vp8x = chunk('VP8X', [0x20, 0, 0, 0, 0xff, 0x01, 0, 0xff, 0x01, 0]);
  const iccp = chunk('ICCP', [1, 2]);
  const output = new Uint8Array(12 + vp8x.length + iccp.length + source.length - 12);
  output.set([0x52, 0x49, 0x46, 0x46], 0);
  output.set([0x57, 0x45, 0x42, 0x50], 8);
  output.set(vp8x, 12);
  output.set(iccp, 12 + vp8x.length);
  output.set(source.slice(12), 12 + vp8x.length + iccp.length);
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return output.buffer;
}

describe('validação estrutural de WebP para arte de tema', () => {
  it('aceita um WebP sintético quadrado de 512 px', () => {
    expect(inspectWebp(decodeBase64(SYNTHETIC_512_WEBP))).toEqual({ height: 512, width: 512 });
  });

  it('aceita o perfil ICC gerado por alguns encoders de canvas, sem aceitar EXIF/XMP', () => {
    expect(inspectWebp(withIccProfile(decodeBase64(SYNTHETIC_512_WEBP)))).toEqual({ height: 512, width: 512 });
  });

  it('rejeita MIME disfarçado, metadata, arquivo truncado e payload acima do hard cap', () => {
    const valid = decodeBase64(SYNTHETIC_512_WEBP);
    expect(inspectWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(inspectWebp(withExif(valid))).toBeNull();
    expect(inspectWebp(valid.slice(0, valid.byteLength - 3))).toBeNull();
    expect(inspectWebp(new ArrayBuffer(THEME_ARTWORK_MAX_BYTES + 1))).toBeNull();
  });
});

/** WebP lossless mínimo com cabeçalho de dimensões arbitrárias (sem pixels reais). */
function losslessHeader(width: number, height: number): ArrayBuffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const payload = [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, ...new Array<number>(15).fill(0)];
  const body = chunk('VP8L', payload);
  const output = new Uint8Array(12 + body.length);
  output.set([0x52, 0x49, 0x46, 0x46], 0);
  output.set([0x57, 0x45, 0x42, 0x50], 8);
  output.set(body, 12);
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  return output.buffer;
}

describe('validação estrutural de WebP para foto de pergunta', () => {
  it('aceita paisagem e retrato até 1280 px e proporção 3:1', () => {
    expect(inspectQuestionImageWebp(losslessHeader(960, 540))).toEqual({ height: 540, width: 960 });
    expect(inspectQuestionImageWebp(losslessHeader(600, 900))).toEqual({ height: 900, width: 600 });
    expect(inspectQuestionImageWebp(decodeBase64(SYNTHETIC_512_WEBP))).toEqual({ height: 512, width: 512 });
  });

  it('rejeita lado grande demais, panorâmica extrema, miniatura, EXIF e excesso de bytes', () => {
    expect(inspectQuestionImageWebp(losslessHeader(1281, 800))).toBeNull();
    expect(inspectQuestionImageWebp(losslessHeader(960, 300))).toBeNull();
    expect(inspectQuestionImageWebp(losslessHeader(63, 63))).toBeNull();
    expect(inspectQuestionImageWebp(withExif(decodeBase64(SYNTHETIC_512_WEBP)))).toBeNull();
    expect(inspectQuestionImageWebp(new ArrayBuffer(QUESTION_IMAGE_MAX_BYTES + 1))).toBeNull();
  });

  it('a arte de tema continua exigindo quadrado entre 256 e 512 px', () => {
    expect(inspectWebp(losslessHeader(960, 540))).toBeNull();
    expect(inspectWebp(losslessHeader(300, 300))).toEqual({ height: 300, width: 300 });
  });
});
