import type { MatchMode } from '@quiz-gomes/domain';

/**
 * "Me chama nessa fila": um link comum do tema com o modo desejado. Quem abre
 * cai na página do tema e entra na fila sozinho (depois de entrar na conta).
 * O link não carrega identidade, sala ou ticket; o servidor revalida tudo.
 */
export const QUEUE_INVITE_PARAM = 'jogar';

export function queueInviteUrl(origin: string, slug: string, mode: MatchMode): string {
  const url = new URL(`/temas/${encodeURIComponent(slug)}`, origin);
  url.searchParams.set(QUEUE_INVITE_PARAM, mode === 'RANKED' ? 'rankeada' : 'normal');
  return url.toString();
}

export function queueInviteMode(search: string): MatchMode | null {
  const value = new URLSearchParams(search).get(QUEUE_INVITE_PARAM);
  if (value === 'normal') return 'CASUAL';
  if (value === 'rankeada') return 'RANKED';
  return null;
}

export type ShareOutcome = 'copied' | 'failed' | 'shared' | 'cancelled';

export async function shareQueueInvite(themeName: string, url: string, mode: MatchMode): Promise<ShareOutcome> {
  const label = mode === 'RANKED' ? 'uma rankeada' : 'uma partida';
  const text = `Bora ${label} de ${themeName} no QUIZ GOMES? Entra na fila comigo:`;
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, title: 'QUIZ GOMES', url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
