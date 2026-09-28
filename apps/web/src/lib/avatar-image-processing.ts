import { decodeImage, effectiveImageType, isSvgFile, paintOpaqueBackground } from './image-input.js';

export const AVATAR_TARGET_BYTES = 40 * 1_024;
export const AVATAR_HARD_CAP_BYTES = 50 * 1_024;
export const AVATAR_DIMENSION = 256;

const MAX_SOURCE_BYTES = 15 * 1_024 * 1_024;
const WEBP_QUALITIES = [0.9, 0.86, 0.82, 0.78, 0.74, 0.68, 0.62, 0.56, 0.5] as const;
const INPUT_TYPES = new Set(['image/avif', 'image/gif', 'image/heic', 'image/jpeg', 'image/png', 'image/webp']);

export interface AvatarCrop {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export function validateAvatarFile(file: File): string | null {
  if (isSvgFile(file)) return 'SVG não é aceito para avatar.';
  if (!INPUT_TYPES.has(effectiveImageType(file) ?? '')) return 'Escolha uma imagem PNG, JPEG, WebP ou AVIF.';
  if (file.size > MAX_SOURCE_BYTES) return 'A imagem selecionada é grande demais para ser processada com segurança.';
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null || blob.type !== 'image/webp') {
      reject(new Error('Este navegador não conseguiu gerar o avatar em WebP.'));
      return;
    }
    resolve(blob);
  }, 'image/webp', quality));
}


function cropBounds(image: HTMLImageElement, crop: AvatarCrop): { size: number; x: number; y: number } {
  const zoom = Math.min(3, Math.max(1, crop.zoom));
  const size = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const normalizedX = (Math.min(100, Math.max(-100, crop.offsetX)) + 100) / 200;
  const normalizedY = (Math.min(100, Math.max(-100, crop.offsetY)) + 100) / 200;
  return {
    size,
    x: (image.naturalWidth - size) * normalizedX,
    y: (image.naturalHeight - size) * normalizedY,
  };
}

export async function processAvatar(file: File, crop: AvatarCrop): Promise<Blob> {
  const validation = validateAvatarFile(file);
  if (validation !== null) throw new Error(validation);
  const image = await decodeImage(file);
  const bounds = cropBounds(image, crop);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_DIMENSION;
  canvas.height = AVATAR_DIMENSION;
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('Não foi possível preparar o editor de avatar.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  paintOpaqueBackground(context, AVATAR_DIMENSION, AVATAR_DIMENSION);
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.size,
    bounds.size,
    0,
    0,
    AVATAR_DIMENSION,
    AVATAR_DIMENSION,
  );

  let hardCapCandidate: Blob | null = null;
  for (const quality of WEBP_QUALITIES) {
    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= AVATAR_TARGET_BYTES) return blob;
    if (blob.size <= AVATAR_HARD_CAP_BYTES && hardCapCandidate === null) hardCapCandidate = blob;
  }
  if (hardCapCandidate !== null) return hardCapCandidate;
  throw new Error('O avatar não pôde ser reduzido ao limite de 50 KB. Escolha outra composição.');
}
