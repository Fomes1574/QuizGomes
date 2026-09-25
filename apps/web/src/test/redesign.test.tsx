// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchResultScreen } from '../components/match-result-screen.js';
import { MatchScreen } from '../components/match-screen.js';
import { ThemeCard } from '../components/theme-card.js';
import { feedback, feedbackPreferences, setFeedbackPreference } from '../lib/feedback.js';
import type { ThemeSummary } from '../lib/models.js';

function theme(activeQuestionCount: number): ThemeSummary {
  return {
    activeQuestionCount,
    artwork: { kind: 'NONE', version: 1 },
    categoryId: 'categoria',
    categoryName: 'Animes',
    coverImageKey: null,
    description: '',
    id: `tema-${activeQuestionCount}`,
    name: `Tema ${activeQuestionCount}`,
    slug: `tema-${activeQuestionCount}`,
  };
}

describe('sons e vibração', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('liga tudo por padrão e guarda a escolha no aparelho', () => {
    expect(feedbackPreferences()).toEqual({ sound: true, vibration: true });
    setFeedbackPreference('sound', false);
    expect(feedbackPreferences()).toEqual({ sound: false, vibration: true });
    expect(JSON.parse(localStorage.getItem('quiz-gomes:feedback') ?? '{}')).toEqual({ sound: false, vibration: true });
  });

  it('só vibra quando a vibração está ligada', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    feedback('correct');
    expect(vibrate).toHaveBeenCalledTimes(1);
    setFeedbackPreference('vibration', false);
    feedback('wrong');
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});

describe('carta de tema', () => {
  afterEach(() => cleanup());

  it('mostra quais modos o tema já libera pelo mesmo limiar do servidor', () => {
    render(<MemoryRouter>
      <ThemeCard theme={theme(5)} />
      <ThemeCard theme={theme(8)} />
      <ThemeCard theme={theme(12)} />
    </MemoryRouter>);
    expect(screen.getByText('Em preparo')).toBeInTheDocument();
    expect(screen.getByText('Partida normal')).toBeInTheDocument();
    expect(screen.getByText('Normal e Rankeada')).toBeInTheDocument();
  });
});

describe('resultado', () => {
  afterEach(() => cleanup());

  it('na Normal não mostra Conhecimento como se tivesse mudado', () => {
    render(<MatchResultScreen
      knowledgeAfter={150}
      knowledgeDelta={0}
      onBack={() => {}}
      opponent={{ name: 'Ana', result: 'LOSS', score: 40 }}
      ranked={false}
      viewer={{ name: 'Gomes', result: 'WIN', score: 60 }}
      xpDelta={20}
    />);
    expect(screen.getByText('Conhecimento intacto')).toBeInTheDocument();
    expect(screen.queryByText('Total no tema')).not.toBeInTheDocument();
    expect(screen.getByText('Mandou bem demais.')).toBeInTheDocument();
  });

  it('escolhe a frase pelo placar, sem inventar desempate', () => {
    const { rerender } = render(<MatchResultScreen
      knowledgeAfter={150}
      knowledgeDelta={30}
      onBack={() => {}}
      opponent={{ name: 'Ana', result: 'LOSS', score: 20 }}
      ranked
      viewer={{ name: 'Gomes', result: 'WIN', score: 60 }}
      xpDelta={30}
    />);
    expect(screen.getByText('Atropelou geral.')).toBeInTheDocument();
    expect(screen.getByText('Total no tema')).toBeInTheDocument();
    rerender(<MatchResultScreen
      knowledgeAfter={120}
      knowledgeDelta={-30}
      onBack={() => {}}
      opponent={{ name: 'Ana', result: 'WIN', score: 100 }}
      ranked
      viewer={{ name: 'Gomes', result: 'LOSS', score: 90 }}
      xpDelta={0}
    />);
    expect(screen.getByText('Por um triz. Foi no detalhe.')).toBeInTheDocument();
  });

  it('oferece jogar de novo, adicionar o adversário e anuncia recorde pessoal', () => {
    const onPlayAgain = vi.fn();
    const onAddFriend = vi.fn();
    const { rerender } = render(<MatchResultScreen
      addFriend={{ onClick: onAddFriend, status: 'idle' }}
      knowledgeAfter={150}
      knowledgeDelta={0}
      onBack={() => {}}
      onPlayAgain={onPlayAgain}
      opponent={{ name: 'Ana Souza', result: 'LOSS', score: 40 }}
      personalRecord
      ranked={false}
      viewer={{ name: 'Gomes', result: 'WIN', score: 60 }}
      xpDelta={20}
    />);
    expect(screen.getByText('Novo recorde pessoal neste tema!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jogar de novo' }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Adicionar Ana/ }));
    expect(onAddFriend).toHaveBeenCalledTimes(1);
    rerender(<MatchResultScreen
      addFriend={{ onClick: onAddFriend, status: 'friend' }}
      knowledgeAfter={150}
      knowledgeDelta={0}
      onBack={() => {}}
      opponent={{ name: 'Ana Souza', result: 'LOSS', score: 40 }}
      ranked={false}
      viewer={{ name: 'Gomes', result: 'WIN', score: 60 }}
      xpDelta={20}
    />);
    expect(screen.queryByRole('button', { name: /Adicionar Ana/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jogar de novo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Novo recorde pessoal neste tema!')).not.toBeInTheDocument();
  });

  it('na revisão mostra a resposta certa com ✓ e a escolha errada com ×', () => {
    render(<MatchResultScreen
      knowledgeAfter={150}
      knowledgeDelta={0}
      onBack={() => {}}
      onReport={() => {}}
      opponent={{ name: 'Ana', result: 'WIN', score: 60 }}
      questions={[
        {
          contextId: 'm', contextKind: 'MATCH', prompt: 'Capital do Brasil?', questionId: 'q1', roundNumber: 1,
          outcome: { correctOption: 1, options: ['Rio', 'Brasília', 'Recife', 'Belém'], selectedOption: 0 },
        },
        {
          contextId: 'm', contextKind: 'MATCH', prompt: 'Maior planeta?', questionId: 'q2', roundNumber: 2,
          outcome: { correctOption: 2, options: ['Marte', 'Terra', 'Júpiter', 'Vênus'], selectedOption: null },
        },
      ]}
      ranked={false}
      viewer={{ name: 'Gomes', result: 'LOSS', score: 40 }}
      xpDelta={0}
    />);
    expect(screen.getByText(/✓\s*B · Brasília/)).toBeInTheDocument();
    expect(screen.getByText(/×\s*Você: A · Rio/)).toBeInTheDocument();
    expect(screen.getByText('Você não respondeu')).toBeInTheDocument();
  });
});

describe('partida pelo teclado', () => {
  afterEach(() => cleanup());

  it('responde com 1 a 4 ou A a D e ignora teclas depois da escolha', () => {
    const onAnswer = vi.fn();
    render(<MatchScreen
      deadlineMs={Date.now() + 8_000}
      onAnswer={onAnswer}
      opponent={{ name: 'Ana' }}
      opponentScore={0}
      player={{ name: 'Gomes' }}
      playerScore={0}
      question={{ options: ['A1', 'B1', 'C1', 'D1'], prompt: 'Pergunta?' }}
      remainingMs={8_000}
      round={{ number: 1, total: 7 }}
    />);
    expect(screen.getByText('Pergunta 1 de 7')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'c' });
    expect(onAnswer).toHaveBeenCalledWith(2);
    fireEvent.keyDown(window, { key: '1' });
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
