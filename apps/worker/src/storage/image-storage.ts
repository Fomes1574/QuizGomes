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
