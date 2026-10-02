/**
 * Porta de entrada comum das fotos (avatar, arte de tema e foto de pergunta).
 * O arquivo escolhido nunca é enviado como veio: cada tela o decodifica e
 * gera um WebP novo no tamanho certo. Aqui só decidimos se vale tentar ler.
 *
 * Alguns celulares e gerenciadores de arquivos informam o tipo como
 * `image/jpg`, `image/pjpeg` ou vazio; nesses casos a extensão decide. HEIC
 * só é lido onde o navegador sabe decodificar (Safari); nos demais a leitura
 * falha com uma mensagem que pede JPEG.
 */
const TYPE_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
  'image/heif': 'image/heic',
};

const EXTENSION_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heic',
  jfif: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Tipo efetivo da imagem, ou `null` quando não parece uma foto raster. */
export function effectiveImageType(file: { name?: string; type: string }): string | null {
  const name = (file.name ?? '').toLocaleLowerCase('pt-BR');
  const declared = file.type.toLowerCase();
  if (declared === 'image/svg+xml' || name.endsWith('.svg')) return null;
  if (declared !== '' && declared !== 'application/octet-stream') return TYPE_ALIASES[declared] ?? declared;
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXTENSION_TYPES[extension] ?? null;
}

export function isSvgFile(file: { name?: string; type: string }): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || (file.name ?? '').toLocaleLowerCase('pt-BR').endsWith('.svg');
}

/**
 * Decodifica o arquivo no navegador (a orientação EXIF da foto de celular já
 * vem aplicada). Falha com mensagem amigável quando o formato não é legível.
 */
export async function decodeImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('unreadable'));
    });
  } catch {
    throw new Error('Não foi possível ler a imagem. Se for HEIC do iPhone, salve como JPEG e tente de novo.');
  } finally {
    URL.revokeObjectURL(url);
  }
  if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('A imagem selecionada está vazia.');
  return image;
}

/**
 * Pinta o fundo antes de desenhar: o WebP sai sem transparência e, sem isto,
 * um PNG com fundo transparente viraria um quadrado preto.
 */
export function paintOpaqueBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
}
