import { describe, expect, it } from 'vitest';
import { busiestOtherTheme, parseQueueActivity, pickSurpriseTheme, totalWaiting } from '../lib/queue-activity.js';
import { queueInviteMode, queueInviteUrl } from '../lib/queue-invite.js';

const themes = [
  { id: 'a', name: 'Animes' },
  { id: 'b', name: 'Bandas' },
  { id: 'c', name: 'Cinema' },
];

describe('fila visível', () => {
  it('lê só entradas válidas e soma por tema', () => {
    const activity = parseQueueActivity([
      { count: 2, mode: 'CASUAL', themeId: 'a' },
      { count: 1, mode: 'RANKED', themeId: 'a' },
      { count: 3, mode: 'HARD', themeId: 'b' },
      { count: -1, mode: 'CASUAL', themeId: 'c' },
      'lixo',
    ]);
    expect(activity).not.toBeNull();
    expect(totalWaiting(activity!, 'a')).toBe(3);
    expect(totalWaiting(activity!, 'b')).toBe(0);
    expect(parseQueueActivity('x')).toBeNull();
  });

  it('Surpreenda-me prefere temas com gente esperando', () => {
    const activity = parseQueueActivity([{ count: 1, mode: 'CASUAL', themeId: 'c' }])!;
    for (const roll of [0, 0.5, 0.99]) expect(pickSurpriseTheme(themes, activity, () => roll)?.id).toBe('c');
    expect(pickSurpriseTheme(themes, new Map(), () => 0.5)?.id).toBe('b');
  });

  it('sugere a fila vizinha mais cheia do mesmo modo, nunca a própria', () => {
    const activity = parseQueueActivity([
      { count: 2, mode: 'CASUAL', themeId: 'a' },
      { count: 5, mode: 'RANKED', themeId: 'b' },
      { count: 3, mode: 'CASUAL', themeId: 'c' },
    ])!;
    expect(busiestOtherTheme(themes, activity, 'a', 'CASUAL')).toEqual({ count: 3, theme: themes[2] });
    expect(busiestOtherTheme(themes, activity, 'b', 'RANKED')).toBeNull();
  });

  it('o link "Me chama nessa fila" só carrega tema e modo', () => {
    const url = queueInviteUrl('https://quiz.example', 'elden-ring', 'RANKED');
    expect(url).toBe('https://quiz.example/temas/elden-ring?jogar=rankeada');
    expect(queueInviteMode(new URL(url).search)).toBe('RANKED');
    expect(queueInviteMode('?jogar=normal')).toBe('CASUAL');
    expect(queueInviteMode('?jogar=dificil')).toBeNull();
  });
});
