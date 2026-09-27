import type { MatchMode } from '@quiz-gomes/domain';

/** Convite de revanche recebido pelo canal social (30 s de validade). */
export interface RematchInvite {
  expiresAt: number;
  fromName: string;
  matchId: string;
  mode: MatchMode;
  themeName: string;
  themeSlug: string;
}

export const REMATCH_INVITE_EVENT = 'qg:rematch-invite';
let latest: RematchInvite | null = null;

/** Valida a mensagem do servidor; qualquer campo estranho descarta o convite. */
export function parseRematchInvite(value: unknown): RematchInvite | null {
  if (typeof value !== 'object' || value === null) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.matchId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.matchId)) return null;
  if (input.mode !== 'CASUAL' && input.mode !== 'RANKED') return null;
  if (typeof input.themeSlug !== 'string' || !/^[a-z0-9-]{1,128}$/i.test(input.themeSlug)) return null;
  if (typeof input.expiresAt !== 'number' || !Number.isFinite(input.expiresAt)) return null;
  return {
    expiresAt: input.expiresAt,
    fromName: typeof input.fromName === 'string' ? input.fromName.slice(0, 40) : 'Seu adversário',
    matchId: input.matchId,
    mode: input.mode,
    themeName: typeof input.themeName === 'string' ? input.themeName.slice(0, 80) : '',
    themeSlug: input.themeSlug,
  };
}

/** Guarda o último convite (para telas que abrem depois) e avisa quem estiver ouvindo. */
export function publishRematchInvite(invite: RematchInvite): void {
  latest = invite;
  window.dispatchEvent(new CustomEvent<RematchInvite>(REMATCH_INVITE_EVENT, { detail: invite }));
}

export function currentRematchInvite(nowMs = Date.now()): RematchInvite | null {
  return latest !== null && latest.expiresAt > nowMs ? latest : null;
}

export function clearRematchInvite(matchId?: string): void {
  if (matchId === undefined || latest?.matchId === matchId) latest = null;
}

/** Estado de navegação que abre a fila privada da revanche no tema. */
export function rematchNavigationState(invite: Pick<RematchInvite, 'fromName' | 'matchId' | 'mode'>) {
  return { autoPlay: true, mode: invite.mode, rematch: invite.matchId, rematchWith: invite.fromName };
}
