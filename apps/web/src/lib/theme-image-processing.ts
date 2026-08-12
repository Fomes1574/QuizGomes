export const THEME_IMAGE_TARGET_BYTES = 55 * 1_024;
export const THEME_IMAGE_HARD_CAP_BYTES = 60 * 1_024;
export const THEME_IMAGE_TARGET_DIMENSION = 512;

const MAX_SOURCE_BYTES = 20 * 1_024 * 1_024;
const OUTPUT_DIMENSIONS = [512, 448, 384, 320, 256] as const;
const WEBP_QUALITIES = [0.92, 0.88, 0.84, 0.8, 0.76, 0.7, 0.64, 0.58, 0.52] as const;
const INPUT_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);

export interface ThemeImageCrop {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface ProcessedThemeImage {
  blob: Blob;
  height: number;
  width: number;
}

export function validateThemeImageFile(file: File): string | null {
  if (file.type === 'image/svg+xml' || file.name.toLocaleLowerCase('pt-BR').endsWith('.svg')) {
    return 'SVG enviado pelo usuário não é aceito.';
  }
  if (!INPUT_TYPES.has(file.type)) return 'Escolha uma imagem PNG, JPEG, WebP ou AVIF.';
  if (file.size > MAX_SOURCE_BYTES) return 'A imagem selecionada é grande demais para ser processada com segurança.';
  return null;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null || blob.type !== 'image/webp') {
      reject(new Error('Este navegador não conseguiu gerar a imagem WebP.'));
      return;
    }
    resolve(blob);
  }, 'image/webp', quality));
}

async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
    });
    if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('A imagem selecionada está vazia.');
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cropBounds(image: HTMLImageElement, crop: ThemeImageCrop): {
  size: number;
  x: number;
  y: number;
} {
  const zoom = Math.min(3, Math.max(1, crop.zoom));
  const size = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const availableX = image.naturalWidth - size;
  const availableY = image.naturalHeight - size;
  const normalizedX = (Math.min(100, Math.max(-100, crop.offsetX)) + 100) / 200;
  const normalizedY = (Math.min(100, Math.max(-100, crop.offsetY)) + 100) / 200;
  return { size, x: availableX * normalizedX, y: availableY * normalizedY };
}

export async function processThemeImage(file: File, crop: ThemeImageCrop): Promise<ProcessedThemeImage> {
  const validation = validateThemeImageFile(file);
  if (validation !== null) throw new Error(validation);
  const image = await decode(file);
  const bounds = cropBounds(image, crop);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('Não foi possível preparar o editor de imagem.');

  let hardCapCandidate: ProcessedThemeImage | null = null;
  for (const dimension of OUTPUT_DIMENSIONS) {
    canvas.width = dimension;
    canvas.height = dimension;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.clearRect(0, 0, dimension, dimension);
    context.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.size,
      bounds.size,
      0,
      0,
      dimension,
      dimension,
    );
    for (const quality of WEBP_QUALITIES) {
      const blob = await canvasBlob(canvas, quality);
      const candidate = { blob, height: dimension, width: dimension };
      if (blob.size <= THEME_IMAGE_TARGET_BYTES) return candidate;
      if (blob.size <= THEME_IMAGE_HARD_CAP_BYTES && hardCapCandidate === null) {
        hardCapCandidate = candidate;
      }
    }
  }
  if (hardCapCandidate !== null) return hardCapCandidate;
  throw new Error('A imagem não pôde ser reduzida ao limite de 60 KB. Escolha outra composição.');
}
