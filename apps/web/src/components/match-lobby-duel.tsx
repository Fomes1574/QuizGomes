import { useEffect, useRef } from 'react';
import {
  captureDuelOrigins,
  playDuelFlip,
  takeDuelOrigin,
  type DuelSeat,
} from '../lib/match-handoff.js';
import { DuelSide, type DuelParticipantView } from './duel-side.js';

const SEATS: readonly DuelSeat[] = ['viewer', 'opponent'];

/**
 * Repete a composição do duelo enquanto a sala se organiza, continuando o movimento
 * iniciado no modal e publicando a própria geometria para o placar da partida.
 */
export function MatchLobbyDuel({ opponent, roomId, viewer }: {
  opponent: DuelParticipantView;
  roomId: string;
  viewer: DuelParticipantView;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    // A geometria em repouso é publicada antes de qualquer animação começar:
    // medir com um transform em curso devolveria a posição animada, não a final.
    const publish = () => captureDuelOrigins(root, roomId, 'lobby');
    publish();
    for (const seat of SEATS) {
      playDuelFlip(
        root.querySelector<HTMLElement>(`[data-duel-flip="${seat}"]`),
        takeDuelOrigin(roomId, 'presentation', seat),
      );
    }
    window.addEventListener('resize', publish);
    return () => window.removeEventListener('resize', publish);
  }, [roomId]);

  return (
    <div className="lobby-duel" ref={rootRef}>
      <DuelSide participant={viewer} seat="viewer" tag="Você" variant="lobby" />
      <span aria-hidden="true" className="duel-lockup duel-lockup--lobby"><strong>VS</strong></span>
      <DuelSide participant={opponent} seat="opponent" tag="Adversário" variant="lobby" />
    </div>
  );
}
