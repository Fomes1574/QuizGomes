import { GAME_DAY_OFFSET_MS, gameDayKey } from './missions.js';

/**
 * Missões semanais da Rankeada (decisão do proprietário, 2026-10-08).
 * A semana do jogo começa na segunda à 0h de Brasília. Só Rankeada
 * concluída de verdade conta; abandono e partida anulada nunca avançam.
 */
export const WEEKLY_MISSION_TYPES = ['PLAY_RANKED', 'WIN_RANKED', 'CORRECT_RANKED'] as const;
export type WeeklyMissionType = (typeof WEEKLY_MISSION_TYPES)[number];

export const WEEKLY_MISSION_DEFINITIONS: ReadonlyArray<{ target: number; type: WeeklyMissionType }> = [
  { target: 10, type: 'PLAY_RANKED' },
  { target: 5, type: 'WIN_RANKED' },
  { target: 40, type: 'CORRECT_RANKED' },
];

export interface WeeklyMissionState {
  completedAt: string | null;
  progress: number;
  target: number;
  type: WeeklyMissionType;
}

/** Uma Rankeada concluída, do ponto de vista de quem jogou. */
export interface WeeklyRankedEvent {
  correctAnswers: number;
  won: boolean;
}

function incrementFor(type: WeeklyMissionType, event: WeeklyRankedEvent): number {
  if (type === 'PLAY_RANKED') return 1;
  if (type === 'WIN_RANKED') return event.won ? 1 : 0;
  return Math.max(0, event.correctAnswers);
}

/** Igual às diárias: nunca regride, satura na meta e marca quando completa. */
export function advanceWeeklyMission(mission: WeeklyMissionState, event: WeeklyRankedEvent, nowIso: string): WeeklyMissionState {
  if (mission.completedAt !== null) return mission;
  const increment = incrementFor(mission.type, event);
  if (increment <= 0) return mission;
  const progress = Math.min(mission.target, mission.progress + increment);
  return { ...mission, completedAt: progress >= mission.target ? nowIso : null, progress };
}

const DAY_MS = 86_400_000;

/** Chave da semana do jogo: a segunda-feira (dia de Brasília) em que ela começou. */
export function gameWeekKey(nowMs: number): string {
  const day = gameDayKey(nowMs);
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  // getUTCDay: 0 = domingo. Segunda vira 0 dias atrás, domingo 6.
  const sinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
  return new Date(dayStart - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** Instante (ms) da próxima segunda à 0h de Brasília. */
export function nextGameWeekStartMs(nowMs: number): number {
  const monday = Date.parse(`${gameWeekKey(nowMs)}T00:00:00.000Z`);
  return monday + 7 * DAY_MS - GAME_DAY_OFFSET_MS;
}
