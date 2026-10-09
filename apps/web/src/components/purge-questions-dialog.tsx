import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.js';

/** Mesma comparação do servidor: sem diferenciar maiúsculas nem espaços nas pontas. */
export function sameThemeName(typed: string, actual: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  return normalize(typed) === normalize(actual);
}

/**
 * Confirmação forte para apagar todas as perguntas de um tema: a pessoa
 * digita o nome do tema. O progresso aparece aqui mesmo enquanto o painel
 * apaga em partes.
 */
export function PurgeQuestionsDialog({
  busy,
  error,
  onCancel,
  onConfirm,
  onExport,
  exporting,
  progress,
  themeName,
}: {
  busy: boolean;
  error: string | null;
  exporting: boolean;
  onCancel: () => void;
  onConfirm: (typedName: string) => void;
  onExport: () => void;
  progress: number | null;
  themeName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const matches = sameThemeName(typed, themeName);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!dialog.open) dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('input')?.focus();
    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      } catch {
        dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      aria-labelledby="purge-dialog-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      ref={dialogRef}
    >
      <form
        className="dialog purge-dialog"
        onSubmit={(event) => { event.preventDefault(); if (matches && !busy) onConfirm(typed); }}
      >
        <h1 id="purge-dialog-title">Apagar as perguntas de “{themeName}”?</h1>
        <p>
          Saem de vez todas as perguntas do tema, em qualquer situação, com alternativas, fontes e fotos.
          As cópias guardadas nas partidas antigas e as denúncias delas também somem.
        </p>
        <p>
          O tema continua: nome, capa, ranking, títulos e placares dos jogadores ficam.
          Não dá para desfazer, então baixe antes a cópia com fotos.
        </p>
        <Button disabled={busy || exporting} onClick={onExport} type="button" variant="ghost">
          {exporting ? 'Preparando o .zip…' : 'Baixar cópia com fotos (.zip)'}
        </Button>
        <label className="field" htmlFor={inputId}>
          <span>Para confirmar, digite o nome do tema</span>
          <input
            autoComplete="off"
            disabled={busy}
            id={inputId}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={themeName}
            spellCheck={false}
            value={typed}
          />
        </label>
        {busy && (
          <p className="inline-notice" role="status">
            {progress === null || progress === 0 ? 'Apagando…' : `Apagando… ${progress} ${progress === 1 ? 'pergunta apagada' : 'perguntas apagadas'}`}
          </p>
        )}
        {error !== null && <p className="form-message form-message--error" role="alert">{error}</p>}
        <div className="dialog__actions">
          <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">Cancelar</Button>
          <Button className="button--danger" disabled={busy || !matches} type="submit">
            {busy ? 'Apagando…' : 'Apagar todas as perguntas'}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
