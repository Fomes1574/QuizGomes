import type { ReportContextKind, ReportReason } from '@quiz-gomes/domain';

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  AMBIGUOUS: 'Ambígua',
  IMAGE: 'Problema na imagem',
  INCORRECT: 'Resposta errada',
  OTHER: 'Outro motivo',
  OUTDATED: 'Desatualizada',
  SOURCE: 'Fonte ou evidência',
  TEXT: 'Erro de texto',
};

export const REPORT_REASON_ORDER: readonly ReportReason[] = [
  'INCORRECT', 'AMBIGUOUS', 'OUTDATED', 'TEXT', 'SOURCE', 'IMAGE', 'OTHER',
];

/** Uma pergunta que o jogador realmente viu nesta sessão, guardada só no cliente. */
export interface SeenQuestion {
  contextId: string;
  contextKind: ReportContextKind;
  /** Preenchido só depois que a rodada resolveu: nunca antecipa a resposta certa. */
  outcome?: {
    correctOption: number;
    options: readonly [string, string, string, string];
    selectedOption: number | null;
  };
  prompt: string;
  questionId: string;
  roundNumber: number;
}

const SEEN_KEY_PREFIX = 'quiz-gomes:seen:';

/**
 * Perguntas já vistas desta partida, guardadas só nesta aba. Um F5 no meio
 * da partida não apaga a revisão final. Só há resposta certa depois que a
 * rodada resolveu, então nada aqui adianta gabarito.
 */
export function loadSeenQuestions(sessionId: string): SeenQuestion[] {
  try {
    const raw = sessionStorage.getItem(`${SEEN_KEY_PREFIX}${sessionId}`);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is SeenQuestion => (
      typeof entry === 'object' && entry !== null
      && typeof (entry as SeenQuestion).questionId === 'string'
      && typeof (entry as SeenQuestion).prompt === 'string'
      && Number.isSafeInteger((entry as SeenQuestion).roundNumber)
    )).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function storeSeenQuestions(sessionId: string, questions: readonly SeenQuestion[]): void {
  try {
    if (questions.length === 0) return;
    sessionStorage.setItem(`${SEEN_KEY_PREFIX}${sessionId}`, JSON.stringify(questions.slice(0, 20)));
  } catch { /* Sem storage: a revisão vale só até o próximo F5. */ }
}
