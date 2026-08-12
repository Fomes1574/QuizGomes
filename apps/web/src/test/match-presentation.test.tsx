// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultScreen } from '../components/match-result-screen.js';
import {
  MATCH_ROUND_TRANSITION_MS,
  MatchRoundTransition,
  roundPresentationDelay,
} from '../components/match-round-transition.js';

describe('apresentação da partida', () => {
  afterEach(() => cleanup());

  it('mantém a apresentação completa em 1.600 ms, respeita o piso do servidor e não repete o título', () => {
    expect(MATCH_ROUND_TRANSITION_MS).toBe(1_600);
    expect(roundPresentationDelay(450)).toBe(1_600);
    expect(roundPresentationDelay(1_100)).toBe(1_600);
    expect(roundPresentationDelay(2_100)).toBe(2_100);

    render(<MatchRoundTransition number={3} total={5} />);
    expect(screen.getByRole('status', { name: 'Pergunta 3 de 5' })).toHaveStyle({
      '--match-question-entrance-duration': '300ms',
      '--round-transition-duration': '1600ms',
    });
    expect(screen.getAllByText('PERGUNTA')).toHaveLength(1);
    expect(screen.queryByText('PERGUNTA 3 / 5')).not.toBeInTheDocument();
  });

  it('mostra os dois perfis, o vencedor, os scores e a progressão autoritativa', () => {
    const onBack = vi.fn();
    render(<MatchResultScreen
      knowledgeAfter={150}
      knowledgeDelta={25}
      onBack={onBack}
      opponent={{ name: 'Ana', result: 'LOSS', score: 42 }}
      viewer={{ frameId: 'frame-existing', name: 'Gomes', result: 'WIN', score: 67 }}
      xpDelta={10}
    />);

    expect(screen.getByRole('heading', { name: 'Vitória' })).toBeInTheDocument();
    expect(screen.getByText('Gomes')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(document.querySelector('.match-result-player--winner')).toBeInTheDocument();
    expect(document.querySelector('[data-frame-id="frame-existing"]')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('+25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar aos temas' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('mantém a anulação clara e não inventa progressão', () => {
    render(<MatchResultScreen
      knowledgeAfter={0}
      knowledgeDelta={0}
      onBack={() => undefined}
      opponent={{ name: 'Ana', result: 'VOID', score: 0 }}
      viewer={{ name: 'Gomes', result: 'VOID', score: 0 }}
      voidReason="INDIVIDUAL_DISCONNECT"
      xpDelta={0}
    />);

    expect(screen.getByRole('heading', { name: 'Partida anulada' })).toBeInTheDocument();
    expect(screen.getByText('A partida foi anulada por perda de conexão.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Progressão da partida' })).not.toBeInTheDocument();
  });
});
