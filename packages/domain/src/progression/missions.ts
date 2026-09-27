/**
 * Missões diárias.
 *
 * Este módulo é puro: descreve as três missões fixas do dia e como um evento
 * autoritativo já persistido (partida válida concluída, resposta registrada,
 * acerto registrado) avança o progresso. O Worker decide quando gerar a linha
 * do dia (uma vez por usuário/dia, por `INSERT OR IGNORE`) e quando aplicar o
 * evento; este módulo nunca lê relógio, nunca soma polling e nunca reduz
 * progresso já alcançado.
 */

export const MISSION_TYPES = ['PLAY_MATCH', 'ANSWER_QUESTIONS', 'CORRECT_ANSWERS'] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export interface MissionDefinition {
  target: number;
  type: MissionType;
}

/** As três missões pessoais fixas do dia. Ordem é apenas de exibição. */
export const DAILY_MISSION_DEFINITIONS: readonly MissionDefinition[] = [
  { target: 1, type: 'PLAY_MATCH' },
  { target: 8, type: 'ANSWER_QUESTIONS' },
  { target: 5, type: 'CORRECT_ANSWERS' },
];

export interface MissionState {
  completedAt: string | null;
  progress: number;
  target: number;
  type: MissionType;
}

/**
 * Evento autoritativo de uma partida/metade concluída de verdade — nunca
 * VOID, cancelada ou uma metade abortada. `totalAnswers`/`correctAnswers`
 * contam apenas as rodadas realmente respondidas por este usuário nesta
 * conclusão.
 */
export interface MissionProgressEvent {
  correctAnswers: number;
  playedValidMatch: boolean;
  totalAnswers: number;
}

function incrementFor(type: MissionType, event: MissionProgressEvent): number {
  if (type === 'PLAY_MATCH') return event.playedValidMatch ? 1 : 0;
  if (type === 'ANSWER_QUESTIONS') return event.totalAnswers;
  return event.correctAnswers;
}

/**
 * Aplica um evento a uma missão específica. Uma missão já completa nunca
 * regride nem ultrapassa a meta; o progresso satura em `target`.
 */
export function advanceMissionProgress(
  mission: MissionState,
  event: MissionProgressEvent,
  nowIso: string,
): MissionState {
  if (mission.completedAt !== null) return mission;
  const increment = incrementFor(mission.type, event);
  if (increment <= 0) return mission;
  const progress = Math.min(mission.target, mission.progress + increment);
  return { ...mission, completedAt: progress >= mission.target ? nowIso : mission.completedAt, progress };
}

/**
 * O dia do jogo é o dia de Brasília (America/Sao_Paulo, UTC−3 fixo: o Brasil
 * não tem horário de verão desde 2019). Missões e ofensivas viram à
 * meia-noite de Brasília, não às 21h do dia anterior como seria em UTC.
 */
export const GAME_DAY_OFFSET_MS = -3 * 60 * 60 * 1_000;
const DAY_MS = 86_400_000;

/** Chave do dia do jogo (`YYYY-MM-DD`) a partir de um instante em ms. */
export function gameDayKey(nowMs: number): string {
  return new Date(nowMs + GAME_DAY_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instante (ms) da próxima meia-noite de Brasília: quando as missões renovam. */
export function nextGameDayStartMs(nowMs: number): number {
  const shifted = nowMs + GAME_DAY_OFFSET_MS;
  return (Math.floor(shifted / DAY_MS) + 1) * DAY_MS - GAME_DAY_OFFSET_MS;
}

/** Dia anterior a uma chave de dia (`YYYY-MM-DD`). */
export function previousDayKey(dayKey: string): string {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
}
