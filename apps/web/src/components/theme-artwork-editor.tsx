import { STANDARD_THEME_ICONS, type StandardThemeIconKey, type ThemeArtwork } from '@quiz-gomes/domain';
import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  processThemeImage,
  validateThemeImageFile,
  type ProcessedThemeImage,
  type ThemeImageCrop,
} from '../lib/theme-image-processing.js';
import { Button } from './button.js';
import { ThemeArtwork as ThemeArtworkPreview } from './theme-artwork.js';
import { ThemeIcon } from './theme-icon.js';

export type ThemeArtworkDraft =
  | { iconKey: StandardThemeIconKey; kind: 'ICON' }
  | { image: ProcessedThemeImage | null; kind: 'CUSTOM' }
  | { kind: 'NONE' };

const DEFAULT_CROP: ThemeImageCrop = { offsetX: 0, offsetY: 0, zoom: 1 };

function previewArtwork(value: ThemeArtworkDraft, currentArtwork: ThemeArtwork): ThemeArtwork {
  if (value.kind === 'ICON') return { ...value, version: currentArtwork.version };
  if (value.kind === 'CUSTOM' && value.image === null && currentArtwork.kind === 'CUSTOM') return currentArtwork;
  return { kind: 'NONE', version: currentArtwork.version };
}

export default function ThemeArtworkEditor({
  currentArtwork,
  disabled = false,
  name,
  onChange,
  value,
}: {
  currentArtwork: ThemeArtwork;
  disabled?: boolean;
  name: string;
  onChange: (value: ThemeArtworkDraft) => void;
  value: ThemeArtworkDraft;
}) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<ThemeImageCrop>(DEFAULT_CROP);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => () => {
    if (processedUrl !== null) URL.revokeObjectURL(processedUrl);
  }, [processedUrl]);

  function resetTransientPreview() {
    setSourceFile(null);
    setSourceUrl(null);
    setProcessedUrl(null);
    setCrop(DEFAULT_CROP);
    setError(null);
  }

  function selectKind(kind: ThemeArtworkDraft['kind']) {
    resetTransientPreview();
    if (kind === 'ICON') {
      const currentKey = value.kind === 'ICON' ? value.iconKey : STANDARD_THEME_ICONS[0].key;
      onChange({ iconKey: currentKey, kind: 'ICON' });
      return;
    }
    if (kind === 'CUSTOM') {
      onChange({ image: null, kind: 'CUSTOM' });
      return;
    }
    onChange({ kind: 'NONE' });
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file === null) return;
    const validation = validateThemeImageFile(file);
    if (validation !== null) {
      setError(validation);
      return;
    }
    setError(null);
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setProcessedUrl(null);
    setCrop(DEFAULT_CROP);
    onChange({ image: null, kind: 'CUSTOM' });
  }

  async function confirmCrop() {
    if (sourceFile === null) return;
    setProcessing(true);
    setError(null);
    try {
      const image = await processThemeImage(sourceFile, crop);
      setProcessedUrl(URL.createObjectURL(image.blob));
      setSourceFile(null);
      setSourceUrl(null);
      onChange({ image, kind: 'CUSTOM' });
    } catch (processingError) {
      setError(processingError instanceof Error ? processingError.message : 'Não foi possível preparar a imagem.');
    } finally {
      setProcessing(false);
    }
  }

  const cropStyle = {
    '--crop-offset-x': `${crop.offsetX * 0.35}%`,
    '--crop-offset-y': `${crop.offsetY * 0.35}%`,
    '--crop-zoom': crop.zoom,
  } as CSSProperties;
  const resolvedPreview = previewArtwork(value, currentArtwork);

  return (
    <fieldset className="theme-artwork-editor" disabled={disabled || processing}>
      <legend>Arte do tema</legend>
      <div aria-label="Tipo de arte" className="theme-artwork-editor__modes" role="radiogroup">
        <button aria-checked={value.kind === 'ICON'} onClick={() => selectKind('ICON')} role="radio" type="button">Ícone padrão</button>
        <button aria-checked={value.kind === 'CUSTOM'} onClick={() => selectKind('CUSTOM')} role="radio" type="button">Imagem personalizada</button>
        <button aria-checked={value.kind === 'NONE'} onClick={() => selectKind('NONE')} role="radio" type="button">Sem imagem</button>
      </div>

      {value.kind === 'ICON' ? (
        <div aria-label="Ícones disponíveis" className="theme-icon-picker" role="list">
          {STANDARD_THEME_ICONS.map((icon) => (
            <span key={icon.key} role="listitem">
              <button
                aria-pressed={value.iconKey === icon.key}
                onClick={() => onChange({ iconKey: icon.key, kind: 'ICON' })}
                type="button"
              >
                <ThemeIcon iconKey={icon.key} />
                <span>{icon.label}</span>
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {value.kind === 'CUSTOM' ? (
        <div className="theme-image-editor">
          <div className="theme-image-editor__preview">
            {sourceUrl !== null ? (
              <span className="theme-image-editor__crop" style={cropStyle}>
                <img alt="Prévia do recorte" src={sourceUrl} />
              </span>
            ) : processedUrl !== null ? (
              <img alt="Prévia da imagem processada" src={processedUrl} />
            ) : (
              <ThemeArtworkPreview artwork={resolvedPreview} decorative={false} eager name={name} />
            )}
          </div>
          <div className="theme-image-editor__controls">
            <label className="file-picker">
              <span>Selecionar imagem</span>
              <input accept="image/avif,image/jpeg,image/png,image/webp" onChange={selectFile} type="file" />
            </label>
            {sourceFile !== null ? (
              <>
                <label><span>Zoom</span><input max="3" min="1" onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} step="0.05" type="range" value={crop.zoom} /></label>
                <label><span>Horizontal</span><input max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, offsetX: Number(event.target.value) }))} type="range" value={crop.offsetX} /></label>
                <label><span>Vertical</span><input max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, offsetY: Number(event.target.value) }))} type="range" value={crop.offsetY} /></label>
                <Button onClick={() => void confirmCrop()} type="button">{processing ? 'Processando…' : 'Confirmar recorte'}</Button>
              </>
            ) : null}
            {value.image !== null ? <small>{value.image.width} × {value.image.height} · {(value.image.blob.size / 1_024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB · WebP</small> : null}
            <p>O arquivo é recortado em quadrado, reencodado sem metadata e limitado a 60 KB. O original não é enviado.</p>
          </div>
        </div>
      ) : null}

      {value.kind === 'NONE' ? (
        <div className="theme-artwork-editor__fallback-preview">
          <ThemeArtworkPreview artwork={{ kind: 'NONE', version: currentArtwork.version }} decorative={false} name={name} />
          <p>As iniciais serão usadas automaticamente.</p>
        </div>
      ) : null}
      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
    </fieldset>
  );
}
