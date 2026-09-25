export interface StoredImage {
  bytes: number;
  contentType: 'image/avif' | 'image/webp';
  key: string;
  license: string;
  sourceUrl: string | null;
  url: string;
}

export interface ImageStorage {
  get(key: string): Promise<StoredImage | null>;
  put?(image: Omit<StoredImage, 'url'>, data: ArrayBuffer): Promise<StoredImage>;
}

const QUESTION_IMAGE_KEY = /^questions\/[0-9a-f-]{36}\/v[1-9]\d*\.webp$/i;

/** Chaves opacas/versionadas aceitas pelo bucket privado de imagens de pergunta. */
export function isQuestionImageKey(key: string): boolean {
  return QUESTION_IMAGE_KEY.test(key);
}

/** A URL nunca expõe bucket nem credencial; o Worker continua sendo o único leitor do R2. */
export function questionImageUrl(key: string): string | null {
  return isQuestionImageKey(key) ? `/api/question-images/${key}` : null;
}

export class R2ImageStorage implements ImageStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async object(key: string): Promise<R2ObjectBody | null> {
    return isQuestionImageKey(key) ? this.bucket.get(key) : null;
  }

  async get(key: string): Promise<StoredImage | null> {
    const object = await this.object(key);
    if (object === null || object.httpMetadata?.contentType !== 'image/webp') return null;
    return {
      bytes: object.size,
      contentType: 'image/webp',
      key,
      license: object.customMetadata?.license ?? '',
      sourceUrl: object.customMetadata?.sourceUrl ?? null,
      url: questionImageUrl(key)!,
    };
  }

  async put(image: Omit<StoredImage, 'url'>, data: ArrayBuffer): Promise<StoredImage> {
    if (!isQuestionImageKey(image.key) || image.contentType !== 'image/webp') {
      throw new Error('INVALID_QUESTION_IMAGE');
    }
    if (data.byteLength !== image.bytes || image.bytes <= 0) {
      throw new Error('QUESTION_IMAGE_SIZE_MISMATCH');
    }
    await this.bucket.put(image.key, data, {
      httpMetadata: { contentType: image.contentType },
      customMetadata: {
        license: image.license,
        ...(image.sourceUrl === null ? {} : { sourceUrl: image.sourceUrl }),
      },
    });
    return { ...image, url: questionImageUrl(image.key)! };
  }
}

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly baseUrl = '/fixtures/images') {}

  get(key: string): Promise<StoredImage | null> {
    if (!/^[a-z0-9][a-z0-9/_-]*\.(?:avif|webp)$/i.test(key)) return Promise.resolve(null);
    return Promise.resolve({
      bytes: 0,
      contentType: key.endsWith('.avif') ? 'image/avif' : 'image/webp',
      key,
      license: 'Fixture local — substituir antes de produção',
      sourceUrl: null,
      url: `${this.baseUrl}/${key}`,
    });
  }
}
