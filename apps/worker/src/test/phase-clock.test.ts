import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PHASE_EARLY_TOLERANCE_MS,
  SIDE_EFFECT_SLOW_LOG_MS,
  TransitionQueue,
  measuredSideEffect,
  phaseClock,
  timerDelay,
} from '../durable-objects/phase-clock.js';

describe('relógio das fases da sala', () => {
  afterEach(() => vi.useRealTimers());

  it('gatilho poucos ms adiantado vale como o prazo na preparação, leitura e resultado', () => {
    for (const phase of ['PREPARING', 'READING', 'ROUND_RESULT']) {
      expect(phaseClock(phase, 10_000, 10_000 - PHASE_EARLY_TOLERANCE_MS)).toBe(10_000);
      expect(phaseClock(phase, 10_000, 9_999)).toBe(10_000);
    }
  });

  it('adiantado demais, sem prazo ou já vencido: usa o relógio real', () => {
    expect(phaseClock('READING', 10_000, 10_000 - PHASE_EARLY_TOLERANCE_MS - 1)).toBe(9_949);
    expect(phaseClock('READING', null, 5)).toBe(5);
    expect(phaseClock('READING', 10_000, 10_250)).toBe(10_250);
  });

  it('nunca adianta prazo de resposta, de "pronto" ou de pausa', () => {
    for (const phase of ['ANSWERING', 'ROUND_READY', 'PAUSED', 'LOBBY']) {
      expect(phaseClock(phase, 10_000, 9_990)).toBe(9_990);
    }
  });

  it('espera do cronômetro nunca é zero nem negativa', () => {
    expect(timerDelay(1_500, 0)).toBe(1_500);
    expect(timerDelay(1_000, 1_000)).toBe(1);
    expect(timerDelay(1_000, 2_000)).toBe(1);
  });

  it('a fila executa uma transição por vez, na ordem, e uma falha não trava as seguintes', async () => {
    const queue = new TransitionQueue();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => { order.push('a:início'); await gate; order.push('a:fim'); });
    const failing = queue.run(() => { order.push('b'); return Promise.reject(new Error('falha sintética')); });
    const third = queue.run(() => { order.push('c'); return Promise.resolve('ok'); });
    await Promise.resolve();
    expect(order).toEqual(['a:início']);
    release();
    await first;
    await expect(failing).rejects.toThrow('falha sintética');
    await expect(third).resolves.toBe('ok');
    expect(order).toEqual(['a:início', 'a:fim', 'b', 'c']);
  });

  it('efeito colateral que falha só vira log; o lento também é registrado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(measuredSideEffect('presence_playing', { matchId: 'm-1' }, () => Promise.reject(new Error('x'))))
      .resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('ROOM_SIDE_EFFECT_FAILED'));

    vi.useFakeTimers();
    const slow = measuredSideEffect('report_view', { matchId: 'm-1' }, () => new Promise((resolve) => {
      setTimeout(resolve, SIDE_EFFECT_SLOW_LOG_MS + 10);
    }));
    await vi.advanceTimersByTimeAsync(SIDE_EFFECT_SLOW_LOG_MS + 10);
    await slow;
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ROOM_SIDE_EFFECT_SLOW'));
  });
});
