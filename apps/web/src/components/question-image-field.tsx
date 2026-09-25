import { useEffect, useId, useRef, useState } from 'react';
import { apiRequest, apiUpload } from '../lib/api.js';
import type { EditorialQuestion } from '../lib/models.js';
import {
  imageFromTransfer,
  processQuestionImage,
  type ProcessedQuestionImage,
} from '../lib/question-image-processing.js';
import { Button } from './button.js';

type GetToken = (forceRefresh?: boolean) => Promise<string | null>;

function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_024))} KB`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

/**
 * Foto opcional de uma pergunta (somente ADMIN). Aceita escolher arquivo,
 * arrastar e soltar ou colar com Ctrl+V; comprime no navegador e mostra a
 * prévia com o tamanho final antes de enviar.
 */
export function QuestionImageField({
  getToken,
  onChanged,
  question,
}: {
  getToken: GetToken;
  onChanged: (question: EditorialQuestion) => void;
  question: EditorialQuestion;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<(ProcessedQuestionImage & { url: string }) | null>(null);
  const [state, setState] = useState<'idle' | 'processing' | 'saving'>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentUrl = question.imageUrl ?? null;

  useEffect(() => () => { if (candidate !== null) URL.revokeObjectURL(candidate.url); }, [candidate]);

  async function accept(file: Blob | null) {
    if (file === null) return;
    setError(null);
    setState('processing');
    try {
      const processed = await processQuestionImage(file);
      setCandidate({ ...processed, url: URL.createObjectURL(processed.blob) });
    } catch (processError) {
      setError(errorText(processError, 'Não foi possível preparar a foto.'));
    } finally {
      setState('idle');
    }
  }

  async function save() {
    if (candidate === null) return;
    setState('saving');
    setError(null);
    try {
      const result = await apiUpload<{ question: EditorialQuestion }>(
        `/api/admin/questions/${encodeURIComponent(question.id)}/image`,
        { body: candidate.blob, getToken, method: 'PUT' },
      );
      setCandidate(null);
      onChanged(result.question);
    } catch (saveError) {
      setError(errorText(saveError, 'Não foi possível salvar a foto.'));
    } finally {
      setState('idle');
    }
  }

  async function remove() {
    setState('saving');
    setError(null);
    try {
      const result = await apiRequest<{ question: EditorialQuestion }>(
        `/api/admin/questions/${encodeURIComponent(question.id)}/image`,
        { getToken, method: 'DELETE' },
      );
      onChanged(result.question);
    } catch (removeError) {
      setError(errorText(removeError, 'Não foi possível remover a foto.'));
    } finally {
      setState('idle');
    }
  }

  const busy = state !== 'idle';
  const preview = candidate?.url ?? currentUrl;

  return (
    <div className="question-image-field">
      <div
        aria-busy={busy}
        aria-label="Foto da pergunta: clique para escolher, arraste uma imagem ou cole com Ctrl+V"
        className={`question-image-field__drop${dragging ? ' question-image-field__drop--over' : ''}`}
        onClick={() => { if (!busy) inputRef.current?.click(); }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void accept(imageFromTransfer(event.dataTransfer)); }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !busy) { event.preventDefault(); inputRef.current?.click(); }
        }}
        onPaste={(event) => {
          const file = imageFromTransfer(event.clipboardData);
          if (file !== null) { event.preventDefault(); void accept(file); }
        }}
        role="button"
        tabIndex={0}
      >
        {preview !== null
          ? <img alt="" className="question-image-field__preview" decoding="async" src={preview} />
          : <span className="question-image-field__hint">📷 Adicionar foto <small>arraste, cole (Ctrl+V) ou clique</small></span>}
        {state === 'processing' && <span className="question-image-field__status">Comprimindo…</span>}
      </div>
      <input
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        className="sr-only"
        id={inputId}
        onChange={(event) => { void accept(event.target.files?.[0] ?? null); event.target.value = ''; }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {candidate !== null && (
        <p className="question-image-field__meta">
          Prévia: {candidate.width} × {candidate.height} px · {kilobytes(candidate.blob.size)}
          {question.status === 'ACTIVE' && ' · vale já nas próximas partidas'}
        </p>
      )}
      <div className="admin-card__actions">
        {candidate !== null ? (
          <>
            <Button disabled={busy} onClick={() => setCandidate(null)} type="button" variant="ghost">Descartar</Button>
            <Button disabled={busy} onClick={() => void save()} type="button">{state === 'saving' ? 'Enviando…' : 'Salvar foto'}</Button>
          </>
        ) : currentUrl !== null && (
          <Button disabled={busy} onClick={() => void remove()} type="button" variant="ghost">{state === 'saving' ? 'Removendo…' : 'Remover foto'}</Button>
        )}
      </div>
      {error !== null && <p className="form-message form-message--error" role="alert">{error}</p>}
    </div>
  );
}
