/**
 * Continuidade visual entre a apresentação do duelo, o lobby da sala e o placar da partida.
 *
 * Guarda apenas a geometria dos avatares já renderizados; nenhuma identidade, pergunta ou
 * dado competitivo trafega por aqui. Perder o handoff apenas remove a animação: as telas
 * continuam corretas porque cada uma renderiza a partir da própria fonte autoritativa.
 */

export type DuelSeat = 'opponent' | 'viewer';
export type DuelStage = 'lobby' | 'presentation';

export interface DuelRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface StoredOrigin {
  capturedAtMs: number;
  rect: DuelRect;
}

const ORIGIN_TTL_MS = 120_000;
const MIN_FLIP_DISTANCE_PX = 2;
const MIN_FLIP_SCALE_DELTA = 0.02;
const MAX_FLIP_SCALE = 8;
const MIN_FLIP_SCALE = 0.05;

let handoffRoomId: string | null = null;
const origins = new Map<string, StoredOrigin>();

function originKey(stage: DuelStage, seat: DuelSeat): string {
  return `${stage}:${seat}`;
}

function isUsableRect(rect: DuelRect): boolean {
  return Number.isFinite(rect.height) && Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) && Number.isFinite(rect.width) &&
    rect.height > 0 && rect.width > 0;
}

function isDuelSeat(value: string | null): value is DuelSeat {
  return value === 'opponent' || value === 'viewer';
}

/** Descarta a geometria acumulada — usado ao trocar de sala e ao sair da partida. */
export function clearDuelHandoff(): void {
  handoffRoomId = null;
  origins.clear();
}

export function rememberDuelOrigin(roomId: string, stage: DuelStage, seat: DuelSeat, rect: DuelRect): void {
  if (roomId === '' || !isUsableRect(rect)) return;
  if (handoffRoomId !== roomId) {
    origins.clear();
    handoffRoomId = roomId;
  }
  origins.set(originKey(stage, seat), { capturedAtMs: Date.now(), rect });
}

/**
 * Mede os elementos marcados com `data-duel-flip` dentro de `root` e guarda a posição atual.
 * A medida considera transformações em curso, então serve tanto em repouso quanto durante a saída.
 */
export function captureDuelOrigins(root: ParentNode | null, roomId: string, stage: DuelStage): void {
  if (root === null || roomId === '') return;
  for (const element of root.querySelectorAll<HTMLElement>('[data-duel-flip]')) {
    const seat = element.getAttribute('data-duel-flip');
    if (!isDuelSeat(seat)) continue;
    const rect = element.getBoundingClientRect();
    rememberDuelOrigin(roomId, stage, seat, {
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    });
  }
}

/** Consome a origem uma única vez: uma animação perdida nunca se repete numa rodada seguinte. */
export function takeDuelOrigin(roomId: string, stage: DuelStage, seat: DuelSeat): DuelRect | null {
  if (roomId === '' || handoffRoomId !== roomId) return null;
  const key = originKey(stage, seat);
  const stored = origins.get(key);
  if (stored === undefined) return null;
  origins.delete(key);
  if (Date.now() - stored.capturedAtMs > ORIGIN_TTL_MS) return null;
  return stored.rect;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Anima `element` a partir de `origin` até a posição que ele já ocupa (FLIP puro).
 * Só usa transform/opacity via WAAPI, não altera layout e falha em silêncio quando
 * o ambiente não suporta a API ou quando a geometria não faz sentido.
 */
export function playDuelFlip(element: HTMLElement | null, origin: DuelRect | null, durationMs = 520): void {
  if (element === null || origin === null || prefersReducedMotion()) return;
  if (typeof element.animate !== 'function') return;
  const target = element.getBoundingClientRect();
  if (!isUsableRect(target) || !isUsableRect(origin)) return;

  const deltaX = (origin.left + origin.width / 2) - (target.left + target.width / 2);
  const deltaY = (origin.top + origin.height / 2) - (target.top + target.height / 2);
  const scale = origin.width / target.width;
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(scale)) return;
  if (scale < MIN_FLIP_SCALE || scale > MAX_FLIP_SCALE) return;
  if (Math.abs(deltaX) < MIN_FLIP_DISTANCE_PX && Math.abs(deltaY) < MIN_FLIP_DISTANCE_PX &&
    Math.abs(scale - 1) < MIN_FLIP_SCALE_DELTA) return;

  try {
    element.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scale})` },
        { transform: 'translate(0px, 0px) scale(1)' },
      ],
      { duration: durationMs, easing: 'cubic-bezier(.22, .75, .2, 1)', fill: 'none' },
    );
  } catch {
    // A continuidade é decorativa: sem ela a tela permanece correta e estática.
  }
}
