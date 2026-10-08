import { DIVISION_THRESHOLDS, DIVISIONS, TIERS, rankForKnowledge, type Tier } from './ranking.js';

/**
 * Conquistas por tema (decisão do proprietário, 2026-10-08).
 *
 * Um catálogo pequeno de regras vale para todos os temas: tema novo já nasce
 * com o conjunto inteiro, sem cadastro manual. Só a Rankeada conta (é o único
 * modo que mede alguém contra o ranking), e só o que o servidor confirmou.
 *
 * Cada conquista também é um título equipável: "Ouro em Lost",
 * "Imparável em Naruto". Conquista nunca some, mesmo se a pessoa cair depois.
 */

export const THEME_ACHIEVEMENT_IDS = [
  'FIRST_WIN',
  'FIRST_PROMOTION',
  'TIER_BRONZE',
  'TIER_SILVER',
  'TIER_GOLD',
  'TIER_PLATINUM',
  'TIER_DIAMOND',
  'TIER_MASTER',
  'TIER_CHALLENGER',
  'PLAYED_10',
  'PLAYED_50',
  'PLAYED_100',
  'PLAYED_500',
  'WIN_STREAK_5',
  'WIN_STREAK_10',
  'UNBEATEN_10',
  'GIANT_SLAYER',
  'ROUT',
] as const;

export type ThemeAchievementId = (typeof THEME_ACHIEVEMENT_IDS)[number];

export type ThemeAchievementGroup = 'feitos' | 'ranking';

const TIER_BY_ACHIEVEMENT: Partial<Record<ThemeAchievementId, Tier>> = {
  TIER_BRONZE: 'Bronze',
  TIER_CHALLENGER: 'Desafiante',
  TIER_DIAMOND: 'Diamante',
  TIER_GOLD: 'Ouro',
  TIER_MASTER: 'Mestre',
  TIER_PLATINUM: 'Platina',
  TIER_SILVER: 'Prata',
};

const PLAYED_TARGET: Partial<Record<ThemeAchievementId, number>> = {
  PLAYED_10: 10, PLAYED_100: 100, PLAYED_50: 50, PLAYED_500: 500,
};

const STREAK_TARGET: Partial<Record<ThemeAchievementId, number>> = { WIN_STREAK_10: 10, WIN_STREAK_5: 5 };

/** Invicto: 10 Rankeadas seguidas sem perder, com pelo menos 5 vitórias no meio. */
export const UNBEATEN_MATCHES = 10;
export const UNBEATEN_MIN_WINS = 5;
/** Atropelo: o dobro dos pontos do adversário, fazendo pelo menos isto. */
export const ROUT_MIN_SCORE = 100;
/** Derrubador de gigantes: o adversário começou pelo menos tantas divisões acima. */
export const GIANT_DIVISION_GAP = 2;

export function isThemeAchievementId(value: string): value is ThemeAchievementId {
  return (THEME_ACHIEVEMENT_IDS as readonly string[]).includes(value);
}

export function themeAchievementGroup(id: ThemeAchievementId): ThemeAchievementGroup {
  return id === 'FIRST_PROMOTION' || TIER_BY_ACHIEVEMENT[id] !== undefined ? 'ranking' : 'feitos';
}

/** Título que a conquista vira, já com o nome do tema. */
export function themeAchievementTitle(id: ThemeAchievementId, themeName: string): string {
  const tier = TIER_BY_ACHIEVEMENT[id];
  if (tier !== undefined) return `${tier} em ${themeName}`;
  switch (id) {
    case 'FIRST_WIN': return `Estreou vencendo em ${themeName}`;
    case 'FIRST_PROMOTION': return `Subindo em ${themeName}`;
    case 'PLAYED_10': return `Pegando o jeito em ${themeName}`;
    case 'PLAYED_50': return `Frequentador de ${themeName}`;
    case 'PLAYED_100': return `Veterano de ${themeName}`;
    case 'PLAYED_500': return `Lenda de ${themeName}`;
    case 'WIN_STREAK_5': return `Embalado em ${themeName}`;
    case 'WIN_STREAK_10': return `Imparável em ${themeName}`;
    case 'UNBEATEN_10': return `Invicto em ${themeName}`;
    case 'GIANT_SLAYER': return `Derrubador de gigantes em ${themeName}`;
    case 'ROUT': return `Atropelador em ${themeName}`;
    default: return themeName;
  }
}

/** Como conseguir, em uma frase. */
export function themeAchievementHint(id: ThemeAchievementId): string {
  const tier = TIER_BY_ACHIEVEMENT[id];
  if (tier !== undefined) return `Chegue a ${tier} neste tema`;
  const played = PLAYED_TARGET[id];
  if (played !== undefined) return `Conclua ${played} Rankeadas neste tema`;
  const streak = STREAK_TARGET[id];
  if (streak !== undefined) return `Vença ${streak} Rankeadas seguidas`;
  switch (id) {
    case 'FIRST_WIN': return 'Vença sua primeira Rankeada neste tema';
    case 'FIRST_PROMOTION': return 'Suba de divisão pela primeira vez';
    case 'UNBEATEN_10': return `Fique ${UNBEATEN_MATCHES} Rankeadas sem perder, vencendo pelo menos ${UNBEATEN_MIN_WINS}`;
    case 'GIANT_SLAYER': return `Vença alguém pelo menos ${GIANT_DIVISION_GAP} divisões acima de você`;
    case 'ROUT': return `Vença com o dobro dos pontos do adversário, fazendo pelo menos ${ROUT_MIN_SCORE}`;
    default: return '';
  }
}

/** Contadores por pessoa e tema; só a Rankeada mexe neles. */
export interface ThemeProgress {
  /** Maior divisão já alcançada no tema (índice 0 = Latão V). */
  bestDivision: number;
  /** Rankeadas concluídas (abandono não conta). */
  completedRanked: number;
  unbeatenMatches: number;
  unbeatenWins: number;
  winStreak: number;
}

export const EMPTY_THEME_PROGRESS: ThemeProgress = Object.freeze({
  bestDivision: 0, completedRanked: 0, unbeatenMatches: 0, unbeatenWins: 0, winStreak: 0,
});

/**
 * Resultado de uma Rankeada para quem jogou. `ABANDONED` é o abandono da
 * própria pessoa (conta como derrota nas sequências e não conta como partida
 * concluída). Partida anulada por falha da sala nem chega aqui.
 */
export interface RankedOutcome {
  knowledgeAfter: number;
  knowledgeBefore: number;
  opponentKnowledgeBefore: number;
  opponentScore: number;
  result: 'ABANDONED' | 'DRAW' | 'LOSS' | 'WIN';
  score: number;
}

/**
 * Aplica uma Rankeada aos contadores e diz quais conquistas a pessoa tem
 * direito agora (inclusive as que já tinha: gravar de novo é inofensivo).
 */
export function applyRankedOutcome(current: ThemeProgress, outcome: RankedOutcome): {
  earned: ThemeAchievementId[];
  progress: ThemeProgress;
} {
  const won = outcome.result === 'WIN';
  const lost = outcome.result === 'LOSS' || outcome.result === 'ABANDONED';
  const before = rankForKnowledge(outcome.knowledgeBefore);
  const after = rankForKnowledge(outcome.knowledgeAfter);
  const progress: ThemeProgress = {
    bestDivision: Math.max(current.bestDivision, before.divisionIndex, after.divisionIndex),
    completedRanked: current.completedRanked + (outcome.result === 'ABANDONED' ? 0 : 1),
    unbeatenMatches: lost ? 0 : current.unbeatenMatches + 1,
    unbeatenWins: lost ? 0 : current.unbeatenWins + (won ? 1 : 0),
    winStreak: won ? current.winStreak + 1 : 0,
  };
  const earned = achievementsFor(progress);
  if (won) {
    earned.push('FIRST_WIN');
    const opponentDivision = rankForKnowledge(outcome.opponentKnowledgeBefore).divisionIndex;
    if (opponentDivision - before.divisionIndex >= GIANT_DIVISION_GAP) earned.push('GIANT_SLAYER');
    if (outcome.score >= ROUT_MIN_SCORE && outcome.score >= outcome.opponentScore * 2) earned.push('ROUT');
  }
  return { earned: [...new Set(earned)], progress };
}

/** Conquistas que os contadores, sozinhos, já garantem. */
export function achievementsFor(progress: ThemeProgress): ThemeAchievementId[] {
  const earned: ThemeAchievementId[] = [];
  if (progress.bestDivision > 0) earned.push('FIRST_PROMOTION');
  const bestTier = rankForKnowledge(DIVISION_THRESHOLDS[progress.bestDivision] ?? 0).tier;
  for (const [id, tier] of Object.entries(TIER_BY_ACHIEVEMENT) as Array<[ThemeAchievementId, Tier]>) {
    if (TIERS.indexOf(bestTier) >= TIERS.indexOf(tier)) earned.push(id);
  }
  for (const [id, target] of Object.entries(PLAYED_TARGET) as Array<[ThemeAchievementId, number]>) {
    if (progress.completedRanked >= target) earned.push(id);
  }
  for (const [id, target] of Object.entries(STREAK_TARGET) as Array<[ThemeAchievementId, number]>) {
    if (progress.winStreak >= target) earned.push(id);
  }
  if (progress.unbeatenMatches >= UNBEATEN_MATCHES && progress.unbeatenWins >= UNBEATEN_MIN_WINS) earned.push('UNBEATEN_10');
  return earned;
}

/**
 * Quanto falta para uma conquista ainda bloqueada, para a barra de "Quase lá".
 * `ratio` vai de 0 a 1.
 */
export function themeAchievementProgress(
  id: ThemeAchievementId,
  context: { knowledge: number; progress: ThemeProgress; wins: number },
): { ratio: number; text: string } {
  const tier = TIER_BY_ACHIEVEMENT[id];
  if (tier !== undefined) {
    const target = DIVISION_THRESHOLDS[TIERS.indexOf(tier) * DIVISIONS.length] ?? 0;
    const missing = Math.max(0, target - context.knowledge);
    return {
      ratio: target === 0 ? 1 : Math.min(1, context.knowledge / target),
      text: missing === 0 ? 'quase lá' : `faltam ${missing.toLocaleString('pt-BR')} de Conhecimento`,
    };
  }
  const played = PLAYED_TARGET[id];
  if (played !== undefined) {
    return { ratio: Math.min(1, context.progress.completedRanked / played), text: `${context.progress.completedRanked} de ${played} Rankeadas` };
  }
  const streak = STREAK_TARGET[id];
  if (streak !== undefined) {
    return { ratio: Math.min(1, context.progress.winStreak / streak), text: `${context.progress.winStreak} de ${streak} vitórias seguidas` };
  }
  if (id === 'UNBEATEN_10') {
    return {
      ratio: Math.min(1, context.progress.unbeatenMatches / UNBEATEN_MATCHES),
      text: `${context.progress.unbeatenMatches} de ${UNBEATEN_MATCHES} sem perder`,
    };
  }
  if (id === 'FIRST_PROMOTION') {
    const next = DIVISION_THRESHOLDS[1] ?? 300;
    return { ratio: Math.min(1, context.knowledge / next), text: `faltam ${Math.max(0, next - context.knowledge)} de Conhecimento` };
  }
  if (id === 'FIRST_WIN') return { ratio: context.wins > 0 ? 1 : 0, text: 'uma vitória Rankeada' };
  return { ratio: 0, text: 'ainda não aconteceu' };
}

/** Faixa visual de um título de Top: ouro, prata, bronze ou comum (4º ao 10º). */
export type TopTitleTier = 'bronze' | 'gold' | 'silver' | 'top';

export const TOP_TITLE_MAX_POSITION = 10;

export function topTitleTier(position: number): TopTitleTier {
  if (position === 1) return 'gold';
  if (position === 2) return 'silver';
  if (position === 3) return 'bronze';
  return 'top';
}

export function topTitleLabel(position: number, themeName: string): string {
  return `Top ${position} em ${themeName}`;
}

/** Estilo visual de um título exibido sob o nome. */
export type PlayerTitleStyle = 'feat' | 'rank' | TopTitleTier;

/** Título que aparece sob o nome do jogador (decidido sempre pelo servidor). */
export interface PlayerTitle {
  label: string;
  /** Posição atual no Top do tema, só para títulos de Top. */
  position?: number;
  style: PlayerTitleStyle;
}

const TITLE_STYLES: ReadonlySet<string> = new Set(['bronze', 'feat', 'gold', 'rank', 'silver', 'top']);

/** Título vindo da rede: só passa se tiver o formato esperado. */
export function parsePlayerTitle(value: unknown): PlayerTitle | null {
  if (typeof value !== 'object' || value === null) return null;
  const { label, position, style } = value as Record<string, unknown>;
  if (typeof label !== 'string' || label.length === 0 || label.length > 160) return null;
  if (typeof style !== 'string' || !TITLE_STYLES.has(style)) return null;
  return {
    label,
    ...(typeof position === 'number' && Number.isInteger(position) ? { position } : {}),
    style: style as PlayerTitleStyle,
  };
}

export function themeAchievementTitleStyle(id: ThemeAchievementId): PlayerTitleStyle {
  return themeAchievementGroup(id) === 'ranking' ? 'rank' : 'feat';
}

/** Conquistas gerais (ofensiva, missões, recorde) também viram título. */
export function globalAchievementTitle(achievementId: string): string | null {
  switch (achievementId) {
    case 'MISSIONS_DAY': return 'Dever cumprido';
    case 'PERSONAL_RECORD': return 'Recordista';
    case 'STREAK_7': return 'Chama acesa';
    case 'STREAK_365': return 'Um ano em chamas';
    case 'STREAK_730': return 'Lenda de dois anos';
    default: {
      const match = /^STREAK_(\d{1,5})$/.exec(achievementId);
      if (match?.[1] === undefined) return null;
      const days = Number(match[1]);
      return days === 100 ? 'Centenário' : `${days} dias em chamas`;
    }
  }
}

/**
 * Marcos de nível que viram título (decisão do proprietário, 2026-10-08):
 * concentrados até o nível 300, onde a maioria vai chegar; depois disso,
 * só o 500 e o 999 como prestígio.
 */
export const LEVEL_TITLES: ReadonlyArray<{ label: string; level: number }> = [
  { label: 'Curioso', level: 5 },
  { label: 'Aprendiz', level: 10 },
  { label: 'Estudioso', level: 25 },
  { label: 'Sabichão', level: 50 },
  { label: 'Erudito', level: 75 },
  { label: 'Enciclopédia ambulante', level: 100 },
  { label: 'Mestre do quiz', level: 150 },
  { label: 'Oráculo', level: 200 },
  { label: 'Sábio', level: 250 },
  { label: 'Lenda do QUIZ GOMES', level: 300 },
  { label: 'Imortal', level: 500 },
  { label: 'Nível 999', level: 999 },
];

export function levelTitle(level: number): string | null {
  return LEVEL_TITLES.find((entry) => entry.level === level)?.label ?? null;
}

/** O próximo marco de nível acima do atual, ou null depois do 999. */
export function nextLevelTitle(currentLevel: number): { label: string; level: number } | null {
  return LEVEL_TITLES.find((entry) => entry.level > currentLevel) ?? null;
}

/**
 * Identificador de título escolhido pelo jogador: `T:<tema>:<conquista>`
 * para conquista de tema, `G:<conquista>` para conquista geral e
 * `N:<nível>` para marco de nível.
 */
export function parseTitleId(value: string):
  | { achievementId: string; kind: 'GLOBAL' }
  | { achievementId: ThemeAchievementId; kind: 'THEME'; themeId: string }
  | { kind: 'LEVEL'; level: number }
  | null {
  if (value.startsWith('N:')) {
    const level = Number(value.slice(2));
    return Number.isInteger(level) && levelTitle(level) !== null ? { kind: 'LEVEL', level } : null;
  }
  if (value.startsWith('G:')) {
    const achievementId = value.slice(2);
    return globalAchievementTitle(achievementId) === null ? null : { achievementId, kind: 'GLOBAL' };
  }
  if (value.startsWith('T:')) {
    const rest = value.slice(2);
    const split = rest.lastIndexOf(':');
    const themeId = rest.slice(0, split);
    const achievementId = rest.slice(split + 1);
    if (split <= 0 || themeId.length > 128 || !isThemeAchievementId(achievementId)) return null;
    return { achievementId, kind: 'THEME', themeId };
  }
  return null;
}

export function themeTitleId(themeId: string, achievementId: ThemeAchievementId): string {
  return `T:${themeId}:${achievementId}`;
}

/** O que uma Rankeada mudou nas conquistas e no Top do tema de quem jogou. */
export interface MatchThemeRewards {
  /** Conquistas que esta partida acabou de liberar, já com o título pronto. */
  achievements: Array<{ id: ThemeAchievementId; title: string }>;
  themeName: string;
  /** Posição no Top do tema antes e depois (null = fora do Top 10). */
  top: { after: number | null; before: number | null };
}

/** Frase do Top depois da partida, ou null quando nada mudou. Sem drama. */
export function topChangeMessage(top: MatchThemeRewards['top'], themeName: string): string | null {
  const { after, before } = top;
  if (after === before) return null;
  if (after === null) return `Você saiu do Top 10 em ${themeName}`;
  if (after === 1) return `Você é o Top 1 em ${themeName}`;
  if (before === null) return `Você entrou no Top 10 em ${themeName}, na posição #${after}`;
  if (after < before) return `Você subiu para #${after} em ${themeName}`;
  return `Sua posição agora é #${after} em ${themeName}`;
}

/**
 * A ordem da trilha do tema: do que costuma sair primeiro ao mais difícil.
 * Serve só para mostrar o caminho; cada conquista continua independente.
 */
export const THEME_TRAIL_ORDER: readonly ThemeAchievementId[] = [
  'FIRST_WIN', 'FIRST_PROMOTION', 'TIER_BRONZE', 'PLAYED_10', 'TIER_SILVER', 'WIN_STREAK_5',
  'TIER_GOLD', 'PLAYED_50', 'GIANT_SLAYER', 'ROUT', 'UNBEATEN_10', 'TIER_PLATINUM', 'PLAYED_100',
  'WIN_STREAK_10', 'TIER_DIAMOND', 'TIER_MASTER', 'PLAYED_500', 'TIER_CHALLENGER',
];
