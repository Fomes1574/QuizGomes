/**
 * Como cada conquista aparece para a pessoa. O servidor só manda o id
 * (`STREAK_100`, `MISSIONS_DAY`…); nome, frase e o "nível" visual do cartão
 * de parabéns ficam aqui. Quanto maior o marco, mais especial o cartão.
 */
export interface AchievementItem {
  achievementId: string;
  frameId: string | null;
  seen?: boolean;
  themeName: string | null;
  unlockedAt: string;
  value: number;
}

export interface FrameItem {
  equipped: boolean;
  id: string;
  name: string;
}

/** Do mais simples ao mais raro; o cartão e a moldura sobem junto. */
export type CelebrationTier = 'ember' | 'bronze' | 'silver' | 'gold' | 'year' | 'platinum' | 'diamond' | 'legend';

export interface AchievementPresentation {
  /** Número grande do cartão ("100", "1", "✓"). */
  big: string;
  /** Legenda embaixo do número grande ("dias", "ano"). */
  bigCaption: string;
  description: string;
  title: string;
  tier: CelebrationTier;
}

export function streakDays(achievementId: string): number | null {
  const match = /^STREAK_(\d{1,5})$/.exec(achievementId);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function streakTier(days: number): CelebrationTier {
  if (days >= 730) return 'legend';
  if (days >= 700) return 'diamond';
  if (days === 365) return 'year';
  if (days >= 400) return 'platinum';
  if (days >= 300) return 'gold';
  if (days >= 200) return 'silver';
  if (days >= 100) return 'bronze';
  return 'ember';
}

const HUNDREDS_TITLES: Record<number, string> = {
  100: 'Centenário',
  200: 'Duzentos dias de fogo',
  300: 'Trezentos e contando',
  400: 'Quatrocentos dias',
  500: 'Meio milhar',
  600: 'Seiscentos dias',
  700: 'Setecentos dias',
};

export function presentAchievement(item: Pick<AchievementItem, 'achievementId' | 'themeName'>): AchievementPresentation {
  const theme = item.themeName === null ? '' : ` em ${item.themeName}`;
  if (item.achievementId === 'MISSIONS_DAY') {
    return { big: '3/3', bigCaption: 'missões', description: 'Cumpriu as três missões de um dia.', tier: 'ember', title: 'Dia completo' };
  }
  if (item.achievementId === 'PERSONAL_RECORD') {
    return { big: '★', bigCaption: 'recorde', description: `Bateu o próprio recorde${theme}.`, tier: 'bronze', title: 'Recordista' };
  }
  const days = streakDays(item.achievementId);
  if (days === 730) {
    return {
      big: '2', bigCaption: 'anos', tier: 'legend', title: 'Lenda de dois anos',
      description: `730 dias seguidos jogando${theme}. Pouquíssima gente chega aqui.`,
    };
  }
  if (days === 365) {
    return {
      big: '1', bigCaption: 'ano', tier: 'year', title: 'Um ano em chamas',
      description: `365 dias seguidos jogando${theme}. Um ano inteiro sem apagar a chama.`,
    };
  }
  if (days === 7) {
    return { big: '7', bigCaption: 'dias', description: `Uma semana seguida jogando${theme}.`, tier: 'ember', title: 'Chama acesa' };
  }
  if (days !== null) {
    return {
      big: days.toLocaleString('pt-BR'), bigCaption: 'dias', tier: streakTier(days),
      title: HUNDREDS_TITLES[days] ?? `${days.toLocaleString('pt-BR')} dias de ofensiva`,
      description: `${days.toLocaleString('pt-BR')} dias seguidos jogando${theme}.`,
    };
  }
  return { big: '✓', bigCaption: '', description: 'Conquista desbloqueada.', tier: 'ember', title: 'Conquista' };
}

/** Nomes das molduras (iguais aos do servidor) e o que fazer para ganhar. */
export const FRAME_CATALOG: ReadonlyArray<{ hint: string; id: string; name: string }> = [
  { hint: '7 dias seguidos jogando', id: 'frame-streak-7', name: 'Chama acesa' },
  { hint: 'As três missões de um dia', id: 'frame-missions', name: 'Dever cumprido' },
  { hint: 'Bata seu recorde num tema', id: 'frame-record', name: 'Recordista' },
  { hint: '100 dias de ofensiva', id: 'frame-streak-100', name: 'Centenário' },
  { hint: '1 ano de ofensiva', id: 'frame-streak-365', name: 'Um ano em chamas' },
  { hint: '2 anos de ofensiva', id: 'frame-streak-730', name: 'Lenda de dois anos' },
];

/** Cores do anel de cada moldura no cartão de perfil compartilhado (iguais ao CSS). */
export const FRAME_RING_COLORS: Readonly<Record<string, [string, string]>> = Object.freeze({
  'frame-missions': ['#a3e635', '#16a34a'],
  'frame-record': ['#fff3b0', '#d4a017'],
  'frame-streak-100': ['#ffd1a1', '#7a3e1d'],
  'frame-streak-365': ['#ffc371', '#7b2ff7'],
  'frame-streak-7': ['#ffd35c', '#ff5e3a'],
  'frame-streak-730': ['#f7d774', '#b31217'],
});
