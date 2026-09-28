import { describe, expect, it } from 'vitest';
import { effectiveImageType, isSvgFile } from '../lib/image-input.js';
import { validateAvatarFile } from '../lib/avatar-image-processing.js';
import { validateQuestionImageFile } from '../lib/question-image-processing.js';
import { validateThemeImageFile } from '../lib/theme-image-processing.js';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('entrada comum de fotos', () => {
  it('normaliza tipos informados de forma diferente por celulares', () => {
    expect(effectiveImageType(file('a.jpg', 'image/jpg'))).toBe('image/jpeg');
    expect(effectiveImageType(file('a.jpg', 'image/pjpeg'))).toBe('image/jpeg');
    expect(effectiveImageType(file('IMG_1.JPG', ''))).toBe('image/jpeg');
    expect(effectiveImageType(file('foto.heif', 'image/heif'))).toBe('image/heic');
    expect(effectiveImageType(file('foto.png', 'application/octet-stream'))).toBe('image/png');
    expect(effectiveImageType(file('sem-extensao', ''))).toBeNull();
  });

  it('SVG nunca entra, nem disfarçado pela extensão', () => {
    expect(isSvgFile(file('a.svg', ''))).toBe(true);
    expect(effectiveImageType(file('a.svg', 'image/png'))).toBeNull();
    expect(validateAvatarFile(file('a.svg', 'image/svg+xml'))).not.toBeNull();
    expect(validateThemeImageFile(file('a.svg', 'image/svg+xml'))).not.toBeNull();
    expect(validateQuestionImageFile(file('a.svg', 'image/svg+xml'))).not.toBeNull();
  });

  it('avatar, tema e pergunta aceitam foto com tipo vazio ou "image/jpg"', () => {
    for (const candidate of [file('IMG_2031.jpg', ''), file('foto.jpg', 'image/jpg')]) {
      expect(validateAvatarFile(candidate)).toBeNull();
      expect(validateThemeImageFile(candidate)).toBeNull();
      expect(validateQuestionImageFile(candidate)).toBeNull();
    }
    expect(validateAvatarFile(file('doc.pdf', 'application/pdf'))).not.toBeNull();
  });
});
