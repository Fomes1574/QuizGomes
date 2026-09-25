// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallInvite } from '../components/install-invite.js';
import { installInviteKind, isIos } from '../lib/install-prompt.js';
import { drawStoryCard, storyCardFileName } from '../lib/story-card.js';

describe('convite para instalar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('reconhece iPhone e iPad (que se apresenta como Mac com toque)', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15)', 5)).toBe(false);
  });

  it('no iPhone mostra o passo a passo uma única vez', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    expect(installInviteKind()).toBe('ios');
    render(<InstallInvite />);
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByText(/Adicionar à Tela de Início/)).not.toBeInTheDocument();
    expect(installInviteKind()).toBeNull();
  });

  it('já instalado nunca convida', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(installInviteKind()).toBeNull();
  });
});

describe('carta de story', () => {
  it('desenha só texto e formas, com o placar e o recorde', () => {
    const texts: string[] = [];
    const noop = () => undefined;
    const gradient = { addColorStop: noop };
    const context = new Proxy({}, {
      get: (_target, property) => {
        if (property === 'fillText') return (text: string) => { texts.push(text); };
        if (property === 'measureText') return (text: string) => ({ width: text.length * 10 });
        if (property === 'createLinearGradient') return () => gradient;
        if (property === 'drawImage') return () => { throw new Error('a carta não pode usar imagem externa'); };
        return noop;
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const input = {
      opponent: { name: 'Ana Souza', score: 40 }, personalRecord: true, ranked: true,
      result: 'WIN' as const, themeName: 'Elden Ring', viewer: { name: 'Mateus Gomes', score: 70 },
    };
    drawStoryCard(context, input);
    expect(texts).toEqual(expect.arrayContaining(['VITÓRIA', 'Elden Ring', 'Partida rankeada', '70', '40', 'MG', 'AS', '★ Novo recorde pessoal']));
    expect(storyCardFileName(input)).toBe('quiz-gomes-vitoria.png');
  });
});
