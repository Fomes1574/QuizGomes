import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  processAvatar,
  validateAvatarFile,
  type AvatarCrop,
} from '../lib/avatar-image-processing.js';
import { Button } from './button.js';

const DEFAULT_CROP: AvatarCrop = { offsetX: 0, offsetY: 0, zoom: 1 };

export default function AvatarEditor({ hasCustomAvatar, onClose, onRemove, onSave }: {
  hasCustomAvatar: boolean;
  onClose: () => void;
  onRemove: () => Promise<void>;
  onSave: (avatar: Blob) => Promise<void>;
}) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(DEFAULT_CROP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (file === null) return;
    const validation = validateAvatarFile(file);
    if (validation !== null) {
      setError(validation);
      return;
    }
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
    setCrop(DEFAULT_CROP);
    setError(null);
  }

  async function save() {
    if (sourceFile === null) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await processAvatar(sourceFile, crop));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar o avatar.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await onRemove();
      onClose();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Não foi possível remover o avatar.');
    } finally {
      setSaving(false);
    }
  }

  const cropStyle = {
    '--crop-offset-x': `${crop.offsetX * 0.35}%`,
    '--crop-offset-y': `${crop.offsetY * 0.35}%`,
    '--crop-zoom': crop.zoom,
  } as CSSProperties;

  return (
    <section aria-label="Editor de avatar" className="avatar-editor">
      <div className="avatar-editor__heading">
        <div><h2>Avatar personalizado</h2><p>O recorte final será quadrado, 256 × 256 px e WebP.</p></div>
        <Button disabled={saving} onClick={onClose} type="button" variant="ghost">Fechar</Button>
      </div>
      <div className="avatar-editor__layout">
        <div className="avatar-editor__preview">
          {sourceUrl === null
            ? <span>Escolha uma imagem</span>
            : <span className="avatar-editor__crop" style={cropStyle}><img alt="Prévia do recorte do avatar" src={sourceUrl} /></span>}
        </div>
        <div className="avatar-editor__controls">
          <label className="file-picker">
            <span>Selecionar imagem</span>
            <input accept="image/avif,image/jpeg,image/png,image/webp" disabled={saving} onChange={selectFile} type="file" />
          </label>
          {sourceFile !== null ? (
            <>
              <label><span>Zoom</span><input disabled={saving} max="3" min="1" onChange={(event) => setCrop((current) => ({ ...current, zoom: Number(event.target.value) }))} step="0.05" type="range" value={crop.zoom} /></label>
              <label><span>Horizontal</span><input disabled={saving} max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, offsetX: Number(event.target.value) }))} type="range" value={crop.offsetX} /></label>
              <label><span>Vertical</span><input disabled={saving} max="100" min="-100" onChange={(event) => setCrop((current) => ({ ...current, offsetY: Number(event.target.value) }))} type="range" value={crop.offsetY} /></label>
              <Button disabled={saving} onClick={() => void save()} type="button">{saving ? 'Processando…' : 'Salvar avatar'}</Button>
            </>
          ) : null}
          {hasCustomAvatar ? <Button disabled={saving} onClick={() => void remove()} type="button" variant="ghost">Remover avatar personalizado</Button> : null}
          <small>O arquivo original não é enviado nem armazenado. SVG não é aceito; o resultado tem limite rígido de 50 KB.</small>
        </div>
      </div>
      {error !== null ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
