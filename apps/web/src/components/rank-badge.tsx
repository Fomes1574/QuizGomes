import { rankForKnowledge } from '@quiz-gomes/domain';

const tierClass: Record<string, string> = {
  Bronze: 'bronze',
  Desafiante: 'challenger',
  Diamante: 'diamond',
  Latão: 'brass',
  Mestre: 'master',
  Ouro: 'gold',
  Platina: 'platinum',
  Prata: 'silver',
};

export function RankBadge({ knowledge, showKnowledge = false }: { knowledge: number; showKnowledge?: boolean }) {
  const rank = rankForKnowledge(knowledge);
  return (
    <span className={`rank-badge rank-badge--${tierClass[rank.tier] ?? 'brass'}`}>
      <span className="rank-badge__gem" aria-hidden="true"><span /></span>
      <span>
        <strong>{rank.tier} {rank.division}</strong>
        {showKnowledge && <small>{rank.knowledge.toLocaleString('pt-BR')} Conhecimento</small>}
      </span>
    </span>
  );
}
