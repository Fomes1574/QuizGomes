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
