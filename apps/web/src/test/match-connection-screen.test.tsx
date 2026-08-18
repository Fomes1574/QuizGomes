// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authoritativeGraceRemainingMs,
  authoritativeGraceSeconds,
  MatchConnectionScreen,
} from '../components/match-connection-screen.js';

describe('relógio visual da pausa autoritativa', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('ignora mudanças no relógio civil e consome somente tempo monotônico', () => {
    const clock = { graceRemainingMs: 6_842, receivedAtMonotonicMs: 1_000 };
    vi.setSystemTime(new Date('2032-01-01T00:00:00Z'));
    expect(authoritativeGraceRemainingMs(clock, 2_000)).toBe(5_842);
    expect(authoritativeGraceSeconds(clock, 2_000)).toBe(6);

    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'));
    expect(authoritativeGraceRemainingMs(clock, 3_000)).toBe(4_842);
    expect(authoritativeGraceSeconds(clock, 3_000)).toBe(5);
  });

  it('mantém dois clientes do mesmo PAUSED dentro da mesma casa visual', () => {
    const playerOne = { graceRemainingMs: 6_842, receivedAtMonotonicMs: 1_000 };
    const playerTwo = { graceRemainingMs: 6_842, receivedAtMonotonicMs: 1_025 };

    expect(authoritativeGraceSeconds(playerOne, 3_100)).toBe(5);
    expect(authoritativeGraceSeconds(playerTwo, 3_100)).toBe(5);
    expect(Math.abs(
      authoritativeGraceRemainingMs(playerOne, 3_100) -
      authoritativeGraceRemainingMs(playerTwo, 3_100),
    )).toBeLessThanOrEqual(25);
  });

  it('ao chegar visualmente a zero apenas confirma encerramento, sem inventar MATCH_VOID', async () => {
    render(
      <MatchConnectionScreen
        authoritativePause={{ graceRemainingMs: 50, receivedAtMonotonicMs: performance.now() }}
        kind="opponent"
      />,
    );
    expect(screen.getByRole('timer')).toHaveAccessibleName('1 segundo restante');

    await act(async () => vi.advanceTimersByTimeAsync(50));

    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByText('Confirmando encerramento da partida...')).toBeInTheDocument();
    expect(screen.queryByText('Partida anulada')).not.toBeInTheDocument();
  });
});
