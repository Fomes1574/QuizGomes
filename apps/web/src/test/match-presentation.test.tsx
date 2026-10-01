// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultScreen } from '../components/match-result-screen.js';

describe('apresentação da partida', () => {
  afterEach(() => cleanup());

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

  it('apresenta cancelamento antes do início com autor real, sem duelo, placar ou progressão', () => {
    const onBack = vi.fn();
    render(<MatchResultScreen
      cancelledBy={{ displayName: 'Fomes', seat: 2 }}
      knowledgeAfter={0}
      knowledgeDelta={0}
      onBack={onBack}
      opponent={{ name: 'Fomes', result: 'VOID', score: 0 }}
      viewer={{ name: 'Gomes', result: 'VOID', score: 0 }}
      voidReason="CANCELLED"
      xpDelta={0}
    />);

    expect(screen.getByRole('heading', { name: 'Partida cancelada' })).toBeInTheDocument();
    expect(screen.getByText('Partida cancelada por Fomes')).toBeInTheDocument();
    expect(screen.queryByText('Partida anulada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Placar final')).not.toBeInTheDocument();
    expect(screen.queryByText('pontos')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao tema' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
