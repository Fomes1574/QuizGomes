/**
 * "Desafiar" na Social leva o jogador a escolher o tema; a página do tema
 * então abre o desafio já com esse amigo. Guardado só nesta aba, por 10
 * minutos: é uma intenção de navegação, não uma autorização (o servidor
 * revalida amizade, presença e regras ao criar o desafio).
 */
export interface ChallengeTarget {
  displayName: string;
  publicId: string;
}

const KEY = 'quiz-gomes:challenge-target';
const TTL_MS = 10 * 60 * 1_000;

export function saveChallengeTarget(target: ChallengeTarget): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...target, savedAt: Date.now() }));
  } catch { /* Sem storage: o jogador escolhe o amigo no próprio tema. */ }
}

export function readChallengeTarget(): ChallengeTarget | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ChallengeTarget & { savedAt: number }>;
    if (typeof parsed.publicId !== 'string' || typeof parsed.displayName !== 'string'
      || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > TTL_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return { displayName: parsed.displayName, publicId: parsed.publicId };
  } catch {
    return null;
  }
}

export function clearChallengeTarget(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* Nada a limpar. */ }
}
