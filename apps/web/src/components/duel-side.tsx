import { useEffect, useState } from 'react';
import { prefersReducedMotion, type DuelSeat } from '../lib/match-handoff.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { RankBadge, rankTierSuffix } from './rank-badge.js';

const KNOWLEDGE_COUNT_MS = 620;

export interface DuelParticipantView {
  customAvatarUrl?: string | null | undefined;
  displayName: string;
  frameId?: string | null | undefined;
  /** Conhecimento do tema; ausente onde a tela não tem valor autoritativo para mostrar. */
  knowledge?: number | undefined;
  photoUrl?: string | null | undefined;
}

function useCountUp(target: number, animated: boolean): number {
  const shouldAnimate = animated && !prefersReducedMotion() &&
    typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
  const [value, setValue] = useState(() => shouldAnimate ? 0 : target);

  useEffect(() => {
    if (!shouldAnimate) return undefined;
    let frame = 0;
    let startedAt: number | null = null;
    const step = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / KNOWLEDGE_COUNT_MS);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [shouldAnimate, target]);

  // Sem animação o valor autoritativo é usado direto, sem depender de nenhum efeito.
  return shouldAnimate ? value : target;
}

function KnowledgeReadout({ animated, knowledge }: { animated: boolean; knowledge: number }) {
  const displayed = useCountUp(knowledge, animated);
  return (
    <span className="duel-side__knowledge">
      {/* O número animado fica fora da árvore acessível para não repetir anúncios no aria-live do diálogo. */}
      <span aria-hidden="true">{displayed.toLocaleString('pt-BR')} Conhecimento</span>
      <span className="sr-only">{knowledge.toLocaleString('pt-BR')} Conhecimento</span>
    </span>
  );
}

export function DuelSide({
  animateKnowledge = false,
  headingId,
  participant,
  seat,
  tag,
  variant = 'presentation',
}: {
  animateKnowledge?: boolean;
  /** Quando presente, o nome vira o título acessível do diálogo em vez de um rótulo comum. */
  headingId?: string | undefined;
  participant: DuelParticipantView;
  seat: DuelSeat;
  tag: string;
  variant?: 'lobby' | 'presentation';
}) {
  const { knowledge } = participant;
  const tierSuffix = knowledge === undefined ? null : rankTierSuffix(knowledge);
  const className = [
    'duel-side',
    `duel-side--${seat}`,
    `duel-side--${variant}`,
    tierSuffix === null ? '' : `duel-side--${tierSuffix}`,
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      <span className="duel-side__portrait">
        <AvatarFrame flipId={seat} frameId={participant.frameId} variant="result">
          <Avatar
            customUrl={participant.customAvatarUrl}
            googleUrl={participant.photoUrl}
            name={participant.displayName}
            size={variant === 'presentation' ? 'large' : 'medium'}
          />
        </AvatarFrame>
        <span aria-hidden="true" className="duel-side__sheen" />
      </span>
      <span className="duel-side__identity">
        <span className="duel-side__tag">{tag}</span>
        {headingId === undefined
          ? <strong className="duel-side__name">{participant.displayName}</strong>
          : <h2 className="duel-side__name" id={headingId}>{participant.displayName}</h2>}
        {knowledge !== undefined && (
          <>
            <RankBadge knowledge={knowledge} />
            <KnowledgeReadout animated={animateKnowledge} knowledge={knowledge} />
          </>
        )}
      </span>
    </div>
  );
}
