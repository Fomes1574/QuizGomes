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
  options: readonly [string, string, string, string];
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

export function publicQuestion(question: SecretQuestion): PublicQuestion {
  return {
    id: question.id,
    imageUrl: question.imageUrl,
    options: question.options,
    prompt: question.prompt,
  };
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
