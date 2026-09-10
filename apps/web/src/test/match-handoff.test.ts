// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureDuelOrigins,
  clearDuelHandoff,
  playDuelFlip,
  takeDuelOrigin,
} from '../lib/match-handoff.js';

const ROOM = 'room-duel';

function anchor(seat: string, rect: { height: number; left: number; top: number; width: number }): HTMLElement {
  const element = document.createElement('span');
  element.setAttribute('data-duel-flip', seat);
  element.getBoundingClientRect = (): DOMRect => ({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    toJSON: () => ({}),
    x: rect.left,
    y: rect.top,
  });
  document.body.append(element);
  return element;
}

describe('continuidade visual do duelo', () => {
  afterEach(() => {
    clearDuelHandoff();
    document.body.replaceChildren();
  });

  it('guarda a geometria dos dois assentos e entrega cada origem uma única vez', () => {
    anchor('viewer', { height: 96, left: 20, top: 200, width: 96 });
    anchor('opponent', { height: 96, left: 20, top: 400, width: 96 });
    captureDuelOrigins(document, ROOM, 'presentation');

    expect(takeDuelOrigin(ROOM, 'presentation', 'viewer')).toEqual({ height: 96, left: 20, top: 200, width: 96 });
    expect(takeDuelOrigin(ROOM, 'presentation', 'viewer')).toBeNull();
    expect(takeDuelOrigin(ROOM, 'presentation', 'opponent')).not.toBeNull();
  });

  it('nunca devolve a geometria de outra sala nem de outra etapa', () => {
    anchor('viewer', { height: 96, left: 20, top: 200, width: 96 });
    captureDuelOrigins(document, ROOM, 'presentation');

    expect(takeDuelOrigin('outra-sala', 'presentation', 'viewer')).toBeNull();
    expect(takeDuelOrigin(ROOM, 'lobby', 'viewer')).toBeNull();
    expect(takeDuelOrigin(ROOM, 'presentation', 'viewer')).not.toBeNull();
  });

  it('descarta tudo ao encerrar a partida', () => {
    anchor('viewer', { height: 96, left: 20, top: 200, width: 96 });
    captureDuelOrigins(document, ROOM, 'lobby');
    clearDuelHandoff();

    expect(takeDuelOrigin(ROOM, 'lobby', 'viewer')).toBeNull();
  });

  it('ignora âncoras sem geometria utilizável em vez de guardar lixo', () => {
    anchor('viewer', { height: 0, left: 0, top: 0, width: 0 });
    captureDuelOrigins(document, ROOM, 'presentation');

    expect(takeDuelOrigin(ROOM, 'presentation', 'viewer')).toBeNull();
  });

  it('anima do ponto de origem até a posição já ocupada, sem tocar no layout', () => {
    const target = anchor('viewer', { height: 38, left: 300, top: 30, width: 38 });
    const animate = vi.fn();
    (target as unknown as { animate: unknown }).animate = animate;

    playDuelFlip(target, { height: 96, left: 20, top: 200, width: 96 });

    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes] = animate.mock.calls[0] as [{ transform: string }[]];
    // Centro de origem (68, 248) contra centro atual (319, 49); escala 96/38.
    expect(keyframes[0]?.transform).toMatch(/^translate\(-251px, 199px\) scale\(2\.5263/);
    expect(keyframes[1]?.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('não anima quando não há origem, quando a API falta ou quando o movimento é irrelevante', () => {
    const target = anchor('viewer', { height: 38, left: 300, top: 30, width: 38 });
    const animate = vi.fn();

    expect(() => playDuelFlip(target, null)).not.toThrow();
    expect(() => playDuelFlip(null, { height: 38, left: 0, top: 0, width: 38 })).not.toThrow();
    expect(animate).not.toHaveBeenCalled();

    (target as unknown as { animate: unknown }).animate = animate;
    playDuelFlip(target, { height: 38, left: 300, top: 30, width: 38 });
    expect(animate).not.toHaveBeenCalled();

    playDuelFlip(target, { height: 1, left: 300, top: 30, width: 1 });
    expect(animate).not.toHaveBeenCalled();
  });
});
