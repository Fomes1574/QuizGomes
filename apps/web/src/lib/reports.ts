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
