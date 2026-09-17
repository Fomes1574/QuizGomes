import type { ReportContextKind, ReportReason } from '@quiz-gomes/domain';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../features/auth-context.js';
import { apiRequest } from '../lib/api.js';
import { REPORT_REASON_LABEL, REPORT_REASON_ORDER } from '../lib/reports.js';
import { Button } from './button.js';

/**
 * Denúncia de pergunta — discreta de propósito.
 *
 * Abrir este diálogo NUNCA toca o estado da rodada: nenhum comando é enviado à
 * sala, nenhum timer é pausado ou recalculado. O servidor continua contando
 * sozinho por trás do modal, exatamente como faria sem ele.
 */
export function ReportQuestionDialog({
  contextId,
  contextKind,
  onClose,
  questionId,
  roundNumber,
}: {
  contextId: string;
  contextKind: ReportContextKind;
  onClose: () => void;
  questionId: string;
  roundNumber: number;
}) {
  const { getToken } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'error' | 'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

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
    dialog.querySelector<HTMLElement>('button, input')?.focus();
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

  async function submit() {
    if (reason === null || status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      const token = await getToken();
      await apiRequest('/api/reports', {
        body: { contextId, contextKind, note: note.trim() === '' ? undefined : note.trim(), questionId, reason, roundNumber },
        getToken,
        method: 'POST',
        token,
      });
      setStatus('sent');
    } catch (submitError) {
      setStatus('error');
      setError(submitError instanceof Error ? submitError.message : 'Não foi possível enviar a denúncia.');
    }
  }

  return createPortal(
    <dialog
      aria-labelledby="report-question-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      ref={dialogRef}
    >
      <section className="dialog dialog--report">
        {status === 'sent' ? (
          <>
            <h1 id="report-question-title">Denúncia registrada</h1>
            <p>Obrigado. A administração vai revisar esta pergunta.</p>
            <div className="dialog__actions"><Button onClick={onClose}>Fechar</Button></div>
          </>
        ) : (
          <>
            <div className="dialog__intro">
              <h1 id="report-question-title">Reportar pergunta</h1>
              <p>Diga o que está errado. Isso não afeta seu tempo nem sua pontuação nesta partida.</p>
            </div>
            <div className="report-reasons" role="radiogroup" aria-label="Motivo da denúncia">
              {REPORT_REASON_ORDER.map((value) => (
                <button
                  aria-checked={reason === value}
                  className={reason === value ? 'difficulty difficulty--active' : 'difficulty'}
                  key={value}
                  onClick={() => setReason(value)}
                  role="radio"
                  type="button"
                >{REPORT_REASON_LABEL[value]}</button>
              ))}
            </div>
            <label className="field">
              <span>Nota opcional</span>
              <textarea
                maxLength={280}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Conte em poucas palavras o que você percebeu."
                rows={3}
                value={note}
              />
              <small>{note.length}/280</small>
            </label>
            {error !== null && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog__actions">
              <Button onClick={onClose} variant="ghost">Cancelar</Button>
              <Button disabled={reason === null || status === 'sending'} onClick={() => void submit()}>
                {status === 'sending' ? 'Enviando...' : 'Enviar denúncia'}
              </Button>
            </div>
          </>
        )}
      </section>
    </dialog>,
    document.body,
  );
}
