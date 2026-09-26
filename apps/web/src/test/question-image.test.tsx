// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchScreen } from '../components/match-screen.js';
import { fitWithin, validateQuestionImageFile } from '../lib/question-image-processing.js';
import { waitForQuestionImage } from '../lib/question-image-ready.js';

describe('processamento da foto de pergunta', () => {
  it('reduz pelo lado maior mantendo a proporção e nunca amplia', () => {
    expect(fitWithin(4000, 3000, 960)).toEqual({ height: 720, width: 960 });
    expect(fitWithin(1080, 1920, 960)).toEqual({ height: 960, width: 540 });
    expect(fitWithin(400, 300, 960)).toEqual({ height: 300, width: 400 });
  });

  it('recusa SVG, formato desconhecido e arquivo gigante', () => {
    expect(validateQuestionImageFile(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).toMatch(/SVG/);
    expect(validateQuestionImageFile(new File(['x'], 'x.bmp', { type: 'image/bmp' }))).toMatch(/PNG, JPEG/);
    const huge = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    Object.defineProperty(huge, 'size', { value: 30 * 1_024 * 1_024 });
    expect(validateQuestionImageFile(huge)).toMatch(/grande demais/);
    expect(validateQuestionImageFile(new File(['x'], 'x.jpg', { type: 'image/jpeg' }))).toBeNull();
  });
});

describe('ROUND_READY esperando a foto', () => {
  afterEach(() => vi.useRealTimers());

  it('resolve na hora sem foto e respeita o teto quando a foto não chega', async () => {
    await expect(waitForQuestionImage(null)).resolves.toBeUndefined();
    vi.useFakeTimers();
    let done = false;
    // jsdom não baixa imagens: só o teto pode liberar.
    void waitForQuestionImage('/api/question-images/questions/nunca/v1.webp', 3_000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });
});

describe('moldura da foto na partida', () => {
  afterEach(() => cleanup());

  it('amplia ao tocar, fecha com Esc e some se a foto falhar', () => {
    render(<MatchScreen
      deadlineMs={Date.now() + 10_000}
      onAnswer={() => {}}
      opponent={{ name: 'Ana' }}
      opponentScore={0}
      player={{ name: 'Gomes' }}
      playerScore={0}
      question={{ imageUrl: '/api/question-images/questions/x/v1.webp', options: ['A1', 'B1', 'C1', 'D1'], prompt: 'Que lugar é este?' }}
      remainingMs={10_000}
      round={{ number: 1, total: 7 }}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Ampliar a foto da pergunta' }));
    expect(screen.getByAltText('Foto da pergunta ampliada')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByAltText('Foto da pergunta ampliada')).not.toBeInTheDocument();
    fireEvent.error(screen.getByAltText('Foto da pergunta'));
    expect(screen.queryByRole('button', { name: 'Ampliar a foto da pergunta' })).not.toBeInTheDocument();
    expect(screen.getByText('Que lugar é este?')).toBeInTheDocument();
  });
});

describe('layout da pergunta sem cortar texto', () => {
  it('alternativas longas viram lista; curtas ficam na grade 2×2', async () => {
    const { questionLayout } = await import('../components/match-screen.js');
    expect(questionLayout({ options: ['Tanjiro', 'Zenitsu', 'Giyu', 'Rengoku'], prompt: 'Quem?' }))
      .toEqual({ answerLayout: 'grid', promptLength: 'short' });
    expect(questionLayout({
      options: ['Transmitir diretamente a sarna humana', 'B', 'C', 'D'],
      prompt: 'Qual é a principal importância médica do ácaro-do-pó-doméstico, apesar de não ser um parasita externo?',
    })).toEqual({ answerLayout: 'list', promptLength: 'long' });
    // Com foto o limite é menor: sobra menos altura na tela.
    expect(questionLayout({ imageUrl: '/x.webp', options: ['Monte Everest', 'B', 'C', 'Kilimanjaro, Tanzânia'], prompt: 'Onde fica?' }).answerLayout).toBe('list');
  });

  it('renderiza o texto inteiro da alternativa e o contador da rodada acessível', () => {
    render(<MatchScreen
      deadlineMs={Date.now() + 10_000}
      onAnswer={() => {}}
      opponent={{ name: 'humberto José da Silva' }}
      opponentScore={0}
      player={{ name: 'Gomes' }}
      playerScore={0}
      question={{ options: ['Ser um aeroalérgeno importante, ligado a asma e rinite', 'B', 'C', 'D'], prompt: 'Pergunta longa?' }}
      remainingMs={10_000}
      round={{ number: 3, total: 7 }}
    />);
    expect(screen.getByText('Ser um aeroalérgeno importante, ligado a asma e rinite')).toBeInTheDocument();
    expect(document.querySelector('.answer-grid--list')).not.toBeNull();
    expect(screen.getByText('Pergunta 3 de 7')).toBeInTheDocument();
    cleanup();
  });
});
