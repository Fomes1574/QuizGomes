// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchScreen } from '../components/match-screen.js';

describe('interface de partida', () => {
  afterEach(() => vi.useRealTimers());

  it('mostra somente placar, pergunta, quatro respostas e timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    const onAnswer = vi.fn();
    render(<MatchScreen
      deadlineMs={Date.now() + 10_000}
      onAnswer={onAnswer}
      opponent={{ name: 'João' }}
      opponentScore={18}
      playerScore={20}
      question={{ options: ['A1', 'B1', 'C1', 'D1'], prompt: 'Pergunta sintética de interface?' }}
    />);
    expect(screen.getByRole('heading', { name: 'Pergunta sintética de interface?' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('timer')).toHaveAccessibleName('10 segundos restantes');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /B1/ }));
    expect(onAnswer).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: /A1/ })).toBeDisabled();
  });

  it('mostra indicador amarelo sem alterar o score revelado', () => {
    render(<MatchScreen
      deadlineMs={Date.now() + 8_000}
      onAnswer={() => undefined}
      opponent={{ name: 'Ana' }}
      opponentAnswered
      opponentScore={11}
      playerScore={10}
      question={{ options: ['A', 'B', 'C', 'D'], prompt: 'Outra pergunta?' }}
    />);
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(document.querySelector('.status-dot--answered')).toBeInTheDocument();
  });
});
