import { TIERS, type PlayerTitle, type PlayerTitleStyle, type Tier } from '@quiz-gomes/domain';

/** Resposta de `/api/profile/titles`. */
export interface TitleShowcaseData {
  autoTop: boolean;
  current: PlayerTitle | null;
  equippedId: string | null;
  /** Título escolhido como objetivo (com o progresso, se ainda não saiu). */
  goal?: ShowcaseTitle | null;
  owned: number;
  pins: string[];
  possible: number;
  titles: ShowcaseTitle[];
}

export interface ShowcaseTitle {
  group: 'feitos' | 'ranking' | 'top';
  hint: string;
  id: string;
  label: string;
  locked?: { ratio: number; text: string };
  position?: number;
  style: PlayerTitleStyle;
}

const TIER_IDS: Record<string, Tier> = {
  TIER_BRONZE: 'Bronze',
  TIER_CHALLENGER: 'Desafiante',
  TIER_DIAMOND: 'Diamante',
  TIER_GOLD: 'Ouro',
  TIER_MASTER: 'Mestre',
  TIER_PLATINUM: 'Platina',
  TIER_SILVER: 'Prata',
};

/**
 * O "selo" de um destaque: posição para Top, a liga para conquista de liga,
 * o número para marcos (10 Rankeadas, 7 dias...). Sem número, um ícone.
 */
export function titleGlyph(title: Pick<ShowcaseTitle, 'id' | 'position'>):
  | { kind: 'icon'; name: 'crown' | 'flame' | 'sparkle' }
  | { kind: 'text'; value: string }
  | { kind: 'tier'; tier: Tier } {
  if (title.position !== undefined) return { kind: 'text', value: `#${title.position}` };
  if (title.id.startsWith('N:')) return { kind: 'text', value: title.id.slice(2) };
  const achievement = title.id.slice(title.id.lastIndexOf(':') + 1);
  const tier = TIER_IDS[achievement];
  if (tier !== undefined && TIERS.includes(tier)) return { kind: 'tier', tier };
  const number = /_(\d+)$/.exec(achievement)?.[1];
  if (number !== undefined) return { kind: 'text', value: number };
  if (achievement === 'PERSONAL_RECORD') return { kind: 'icon', name: 'crown' };
  return { kind: 'icon', name: 'sparkle' };
}
