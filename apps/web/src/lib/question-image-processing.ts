/**
 * Foto de pergunta: o navegador do ADMIN faz todo o trabalho pesado. A saída
 * é sempre um WebP novo (sem EXIF/GPS: o canvas descarta metadados), com o
 * lado maior até 960 px e cerca de 60 KB, para abrir rápido no 4G e caber
 * folgado no limite de 100 KB validado pelo Worker. A orientação EXIF da foto
 * de celular já vem aplicada pelo decodificador do navegador.
 */
export const QUESTION_IMAGE_TARGET_BYTES = 60 * 1_024;
export const QUESTION_IMAGE_HARD_CAP_BYTES = 100 * 1_024 - 1;
export const QUESTION_IMAGE_MAX_DIMENSION = 960;

const MAX_SOURCE_BYTES = 25 * 1_024 * 1_024;
const MIN_SOURCE_DIMENSION = 64;
const MAX_ASPECT_RATIO = 3;
const LONGEST_SIDES = [960, 840, 720, 640] as const;
const WEBP_QUALITIES = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5] as const;
const INPUT_TYPES = new Set(['image/avif', 'image/gif', 'image/heic', 'image/jpeg', 'image/png', 'image/webp']);

export interface ProcessedQuestionImage {
  blob: Blob;
  height: number;
  width: number;
}

export function validateQuestionImageFile(file: Blob & { name?: string }): string | null {
  const name = (file.name ?? '').toLocaleLowerCase('pt-BR');
  if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return 'SVG não é aceito como foto de pergunta.';
  if (!INPUT_TYPES.has(file.type)) return 'Use uma foto PNG, JPEG, WebP, AVIF ou GIF.';
  if (file.size > MAX_SOURCE_BYTES) return 'A foto é grande demais para processar com segurança (máx. 25 MB).';
  return null;
}

/** Primeira imagem da área de transferência (Ctrl+V) ou de um arrastar-e-soltar. */
export function imageFromTransfer(transfer: DataTransfer | null): File | null {
  if (transfer === null) return null;
  for (const file of Array.from(transfer.files)) {
    if (file.type.startsWith('image/')) return file;
  }
  for (const item of Array.from(transfer.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file !== null) return file;
    }
  }
  return null;
}

/** Cabe no lado maior preservando a proporção; nunca amplia uma foto pequena. */
export function fitWithin(width: number, height: number, longest: number): { height: number; width: number } {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { height: Math.max(1, Math.round(height * scale)), width: Math.max(1, Math.round(width * scale)) };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null || blob.type !== 'image/webp') {
      reject(new Error('Este navegador não conseguiu gerar WebP. Tente pelo Chrome, Edge ou Firefox.'));
      return;
    }
    resolve(blob);
  }, 'image/webp', quality));
}

async function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Não foi possível ler a foto.'));
    });
    return image;
  } catch {
    throw new Error('Não foi possível ler a foto. Se for HEIC do iPhone, exporte como JPEG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function processQuestionImage(file: Blob & { name?: string }): Promise<ProcessedQuestionImage> {
  const validation = validateQuestionImageFile(file);
  if (validation !== null) throw new Error(validation);
  const image = await decode(file);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (Math.min(sourceWidth, sourceHeight) < MIN_SOURCE_DIMENSION) throw new Error('A foto é pequena demais (mín. 64 px).');
  if (Math.max(sourceWidth, sourceHeight) / Math.min(sourceWidth, sourceHeight) > MAX_ASPECT_RATIO) {
    throw new Error('A foto é estreita demais. Recorte para uma proporção até 3:1.');
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (context === null) throw new Error('Não foi possível preparar a foto.');

  let hardCapCandidate: ProcessedQuestionImage | null = null;
  for (const longest of LONGEST_SIDES) {
    const size = fitWithin(sourceWidth, sourceHeight, longest);
    if (Math.min(size.width, size.height) < MIN_SOURCE_DIMENSION) break;
    canvas.width = size.width;
    canvas.height = size.height;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // Fundo neutro: PNG com transparência não vira preto no WebP sem alfa.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    for (const quality of WEBP_QUALITIES) {
      const blob = await canvasBlob(canvas, quality);
      const candidate = { blob, ...size };
      if (blob.size <= QUESTION_IMAGE_TARGET_BYTES) return candidate;
      if (blob.size <= QUESTION_IMAGE_HARD_CAP_BYTES && hardCapCandidate === null) hardCapCandidate = candidate;
    }
    // Menor que o alvo em nenhuma qualidade? Fica com o melhor candidato
    // dentro do teto antes de reduzir a resolução.
    if (hardCapCandidate !== null) return hardCapCandidate;
  }
  throw new Error('A foto tem detalhes demais para caber em 100 KB. Recorte ou escolha outra.');
}
