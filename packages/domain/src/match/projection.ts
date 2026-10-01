export interface SecretQuestion {
  correctOption: number;
  id: string;
  imageUrl: string | null;
  options: readonly [string, string, string, string];
  prompt: string;
}

export interface PublicQuestion {
  id: string;
  imageUrl: string | null;
  /**
   * Ausente durante a leitura (antes de o relógio da rodada começar): o
   * servidor só libera as alternativas quando a resposta passa a valer.
   */
  options?: readonly [string, string, string, string];
  prompt: string;
}

export interface SealedAnswer {
  correct: boolean;
  remainingMs: number;
  score: number;
  selectedOption: number | null;
}

export interface RoundProjection {
  correctOption?: number;
  opponent: {
    answered: boolean;
    correct?: boolean;
    score?: number;
    selectedOption?: number | null;
  };
  question: PublicQuestion;
  viewer?: {
    correct: boolean;
    score: number;
    selectedOption: number | null;
  };
}

export function publicQuestion(question: SecretQuestion, withOptions = true): PublicQuestion {
  const visible: PublicQuestion = {
    id: question.id,
    imageUrl: question.imageUrl,
    prompt: question.prompt,
  };
  if (withOptions) visible.options = question.options;
  return visible;
}

export function projectRoundForViewer(
  question: SecretQuestion,
  viewerAnswer: SealedAnswer | null,
  opponentAnswer: SealedAnswer | null,
): RoundProjection {
  const projection: RoundProjection = {
    opponent: { answered: opponentAnswer !== null },
    question: publicQuestion(question),
  };
  if (viewerAnswer === null) return projection;

  projection.viewer = {
    correct: viewerAnswer.correct,
    score: viewerAnswer.score,
    selectedOption: viewerAnswer.selectedOption,
  };
  if (opponentAnswer !== null) {
    projection.opponent = {
      answered: true,
      correct: opponentAnswer.correct,
      score: opponentAnswer.score,
      selectedOption: opponentAnswer.selectedOption,
    };
    projection.correctOption = question.correctOption;
  }
  return projection;
}
