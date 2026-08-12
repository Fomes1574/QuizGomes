// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchScreen } from '../components/match-screen.js';

const PLAYER = { name: 'Gomes' };
const QUESTION = {
  options: ['A1', 'B1', 'C1', 'D1'] as const,
  prompt: 'Pergunta sintética de interface?',
};

describe('interface de partida', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanup();
  });

  it('isola o timer, atualiza apenas o segundo inteiro e não usa setInterval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const onAnswer = vi.fn();
    render(<MatchScreen
      deadlineMs={Date.now() + 10_000}
      onAnswer={onAnswer}
      opponent={{ name: 'João' }}
      opponentScore={18}
      player={PLAYER}
      playerScore={20}
      question={QUESTION}
      remainingMs={10_000}
    />);

    expect(screen.getByRole('heading', { name: QUESTION.prompt })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('timer')).toHaveAccessibleName('10 segundos restantes');
    expect(document.querySelector('.match-timer__bar--running')).toHaveStyle({
      '--timer-duration': '10000ms',
      '--timer-from-ratio': '1',
    });
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('9 segundos restantes');

    fireEvent.click(screen.getByRole('button', { name: /B1/ }));
    expect(onAnswer).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /A1/ })).toBeDisabled();
  });

  it('desabilita as respostas quando o deadline visual termina sem decidir o resultado', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    const onAnswer = vi.fn();
    render(<MatchScreen
      deadlineMs={Date.now() + 10_000}
      onAnswer={onAnswer}
      opponent={{ name: 'João' }}
      opponentScore={0}
      player={PLAYER}
      playerScore={0}
      question={QUESTION}
      remainingMs={10_000}
    />);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('0 segundos restantes');
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('congela no remainingMs autoritativo enquanto a partida está pausada', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    render(<MatchScreen
      deadlineMs={Date.now() + 2_000}
      onAnswer={() => undefined}
      opponent={{ name: 'Ana' }}
      opponentScore={11}
      paused
      pausedRemainingMs={6_432}
      player={PLAYER}
      playerScore={10}
      question={QUESTION}
      remainingMs={6_432}
    />);

    expect(screen.getByRole('timer')).toHaveAccessibleName('7 segundos restantes');
    expect(document.querySelector('.match-timer__bar--paused')).toHaveStyle({
      '--timer-from-ratio': '0.6432',
    });
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole('timer')).toHaveAccessibleName('7 segundos restantes');
  });

  it('mostra indicador amarelo sem alterar o score revelado', () => {
    render(<MatchScreen
      deadlineMs={Date.now() + 8_000}
      onAnswer={() => undefined}
      opponent={{ name: 'Ana' }}
      opponentAnswered
      opponentScore={11}
      player={PLAYER}
      playerScore={10}
      question={QUESTION}
      remainingMs={8_000}
    />);
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(document.querySelector('.status-dot--answered')).toBeInTheDocument();
  });

  it('revela o feedback seguro e atualiza o placar somente na etapa de 450 ms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    const view = render(<MatchScreen
      deadlineMs={Date.now() + 8_000}
      onAnswer={() => undefined}
      opponent={{ name: 'Ana' }}
      opponentScore={10}
      player={PLAYER}
      playerScore={20}
      question={QUESTION}
      remainingMs={8_000}
    />);

    view.rerender(<MatchScreen
      deadlineMs={Date.now()}
      onAnswer={() => undefined}
      opponent={{ name: 'Ana' }}
      opponentScore={27}
      player={PLAYER}
      playerScore={37}
      question={QUESTION}
      remainingMs={0}
      resolution={{
        correctOption: 2,
        viewer: { correct: true, roundScore: 17, selectedOption: 2 },
      }}
    />);

    expect(screen.getByLabelText('17 pontos ganhos')).toHaveTextContent('+17');
    expect(screen.getByRole('button', { name: /C1 — correta — resposta correta do adversário/ })).toBeDisabled();
    expect(screen.getAllByLabelText('Foto de Ana')).toHaveLength(2);
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.queryByText('37')).not.toBeInTheDocument();
    expect(screen.queryByText('27')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(449));
    expect(screen.queryByText('37')).not.toBeInTheDocument();
    expect(screen.queryByText('27')).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
  });
});
