// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallInvite } from '../components/install-invite.js';
import { installInviteKind, isIos } from '../lib/install-prompt.js';
import {
  drawInviteCard,
  drawMilestoneCard,
  drawProfileCard,
  drawStoryCard,
  resultHook,
  shareHost,
  storyCardFileName,
} from '../lib/story-card.js';

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

function recordingContext(texts: string[], images: unknown[] = []): CanvasRenderingContext2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return new Proxy({}, {
    get: (_target, property) => {
      if (property === 'fillText') return (text: string) => { texts.push(text); };
      if (property === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
      if (property === 'drawImage') return (image: unknown) => { images.push(image); };
      return noop;
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

describe('cartões de compartilhamento', () => {
  const input = {
    host: 'quiz.example',
    opponent: { name: 'Ana Souza', score: 40 }, personalRecord: true, ranked: true,
    result: 'WIN' as const, themeName: 'Elden Ring', viewer: { name: 'Mateus Gomes', score: 70 },
  };

  it('resultado: placar, recorde, marca e o desafio com o endereço para jogar', () => {
    const texts: string[] = [];
    drawStoryCard(recordingContext(texts), input);
    expect(texts).toEqual(expect.arrayContaining([
      'QUIZ GOMES', 'VITÓRIA', 'Elden Ring', 'PARTIDA RANKEADA', '70', '40', 'MG', 'AS', '★ Novo recorde pessoal',
      'Duvido você me ganhar em Elden Ring.', 'Quiz 1×1 grátis · quiz.example',
    ]));
    expect(storyCardFileName(input)).toBe('quiz-gomes-vitoria.jpg');
  });

  it('sem imagem usa iniciais; com foto carregada, desenha a foto no lugar', () => {
    const images: unknown[] = [];
    const texts: string[] = [];
    const photo = { kind: 'foto' };
    drawStoryCard(recordingContext(texts, images), input, { viewer: photo as unknown as CanvasImageSource });
    expect(images).toEqual([photo]);
    expect(texts).not.toContain('MG');
    expect(texts).toContain('AS');
  });

  it('derrota provoca sem mentir; perfil, marco e convite trazem o chamado', () => {
    expect(resultHook({ opponent: { name: 'x', score: 100 }, result: 'LOSS', viewer: { name: 'y', score: 90 } })).toBe('Perdi por um triz.');
    expect(resultHook({ opponent: { name: 'x', score: 40 }, result: 'WIN', viewer: { name: 'y', score: 90 } })).toBe('Atropelei geral.');
    const profile: string[] = [];
    drawProfileCard(recordingContext(profile), {
      bestTheme: { name: 'Naruto', rankLabel: 'Ouro II' }, host: 'quiz.example', level: 12, name: 'Mateus', publicId: '#QGABC', streak: 8, wins: 31,
    });
    expect(profile).toEqual(expect.arrayContaining(['Mateus', '#QGABC', '12', '8 dias', '31', 'Ouro II', 'Me desafia no QUIZ GOMES']));
    const milestone: string[] = [];
    drawMilestoneCard(recordingContext(milestone), {
      big: '100', bigCaption: 'dias', description: '100 dias seguidos jogando.', host: 'quiz.example', name: 'Mateus', tier: 'bronze', title: 'Centenário',
    });
    expect(milestone).toEqual(expect.arrayContaining(['CONQUISTA DESBLOQUEADA', '100', 'DIAS', 'Centenário', 'Consegue chegar aqui?']));
    const invite: string[] = [];
    drawInviteCard(recordingContext(invite), { host: 'quiz.example', name: 'Mateus', publicId: '#QGABC' });
    expect(invite).toEqual(expect.arrayContaining(['BORA', 'DUELAR?', 'Me adiciona: #QGABC', 'Jogue grátis · quiz.example']));
    expect(shareHost('https://quiz.example')).toBe('quiz.example');
  });
});
