export const THEME_ARTWORK_MAX_BYTES = 60 * 1_024;
export const THEME_ARTWORK_MAX_DIMENSION = 512;
export const THEME_ARTWORK_MIN_DIMENSION = 256;

export interface WebpInspection {
  height: number;
  width: number;
}

// VP8X feature flags, in the low byte defined by RFC 9649.  EXIF/XMP and
// animation remain intentionally unsupported for theme artwork.  ICCP is a
// colour profile, not user-authored image metadata, and is emitted by some
// browser WebP encoders after a canvas re-encode.
const VP8X_ALPHA_FLAG = 0x10;
const VP8X_ICCP_FLAG = 0x20;
const VP8X_ALLOWED_FLAGS = VP8X_ALPHA_FLAG | VP8X_ICCP_FLAG;

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function uint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function vp8Dimensions(bytes: Uint8Array, offset: number, size: number): WebpInspection | null {
  if (size < 10 || bytes[offset + 3] !== 0x9d || bytes[offset + 4] !== 0x01 || bytes[offset + 5] !== 0x2a) return null;
  const width = ((bytes[offset + 6] ?? 0) | ((bytes[offset + 7] ?? 0) << 8)) & 0x3fff;
  const height = ((bytes[offset + 8] ?? 0) | ((bytes[offset + 9] ?? 0) << 8)) & 0x3fff;
  return width > 0 && height > 0 ? { height, width } : null;
}

function vp8lDimensions(bytes: Uint8Array, offset: number, size: number): WebpInspection | null {
  if (size < 5 || bytes[offset] !== 0x2f) return null;
  const bits = (
    (bytes[offset + 1] ?? 0)
    | ((bytes[offset + 2] ?? 0) << 8)
    | ((bytes[offset + 3] ?? 0) << 16)
    | ((bytes[offset + 4] ?? 0) << 24)
  ) >>> 0;
  return { height: ((bits >>> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 };
}

function vp8xDimensions(bytes: Uint8Array, offset: number, size: number): WebpInspection | null {
  if (size < 10) return null;
  return { height: uint24(bytes, offset + 7) + 1, width: uint24(bytes, offset + 4) + 1 };
}

export function inspectWebp(data: ArrayBuffer): WebpInspection | null {
  if (data.byteLength < 30 || data.byteLength > THEME_ARTWORK_MAX_BYTES) return null;
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  if (fourCc(bytes, 0) !== 'RIFF' || fourCc(bytes, 8) !== 'WEBP') return null;
  if (view.getUint32(4, true) + 8 !== data.byteLength) return null;

  let canvas: WebpInspection | null = null;
  let canvasFlags: number | null = null;
  let encoded: WebpInspection | null = null;
  let alphaChunk = false;
  let iccpChunk = false;
  let foundImageChunks = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    const end = payload + size;
    if (end > bytes.length) return null;
    if (!['ALPH', 'ICCP', 'VP8 ', 'VP8L', 'VP8X'].includes(kind)) return null;
    if (kind === 'VP8X') {
      const flags = bytes[payload] ?? 0;
      if (
        canvas !== null
        || alphaChunk
        || foundImageChunks > 0
        || size !== 10
        || (flags & ~VP8X_ALLOWED_FLAGS) !== 0
        || bytes[payload + 1] !== 0
        || bytes[payload + 2] !== 0
        || bytes[payload + 3] !== 0
      ) return null;
      canvas = vp8xDimensions(bytes, payload, size);
      canvasFlags = flags;
    }
    if (kind === 'ICCP') {
      // A profile is only legal in the extended container and comes before
      // image data.  This keeps EXIF/XMP and arbitrary RIFF payloads out.
      if (canvas === null || iccpChunk || alphaChunk || foundImageChunks > 0 || size === 0) return null;
      iccpChunk = true;
    }
    if (kind === 'ALPH') {
      if (alphaChunk || size < 2) return null;
      alphaChunk = true;
    }
    if (kind === 'VP8 ') {
      foundImageChunks += 1;
      encoded = vp8Dimensions(bytes, payload, size);
    }
    if (kind === 'VP8L') {
      foundImageChunks += 1;
      encoded = vp8lDimensions(bytes, payload, size);
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || foundImageChunks !== 1 || encoded === null) return null;
  if (canvas !== null && (((canvasFlags ?? 0) & VP8X_ICCP_FLAG) !== 0) !== iccpChunk) return null;
  if (canvas === null && iccpChunk) return null;
  if (alphaChunk && canvas === null) return null;
  const dimensions = canvas ?? encoded;
  if (dimensions === null) return null;
  if (canvas !== null && (canvas.width !== encoded.width || canvas.height !== encoded.height)) return null;
  if (dimensions.width !== dimensions.height) return null;
  if (dimensions.width < THEME_ARTWORK_MIN_DIMENSION || dimensions.width > THEME_ARTWORK_MAX_DIMENSION) return null;
  return dimensions;
}
