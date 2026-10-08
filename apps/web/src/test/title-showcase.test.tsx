// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultScreen } from '../components/match-result-screen.js';
import { TitleShowcase } from '../components/title-showcase.js';
import type { TitleShowcaseData } from '../lib/titles.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('token')),
}));

vi.mock('../features/auth-context.js', () => ({ useAuth: () => ({ getToken: mocks.getToken }) }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

const viewer = { customAvatarUrl: null, displayName: 'Gomes', frameId: null, photoUrl: null };

function showcase(overrides: Partial<TitleShowcaseData> = {}): TitleShowcaseData {
  return {
    autoTop: true,
    current: { label: 'Top 1 em Lost', position: 1, style: 'gold' },
    equippedId: 'TOP:lost',
    owned: 3,
    pins: ['TOP:lost'],
    possible: 20,
    titles: [
      { group: 'top', hint: 'Sua posição hoje.', id: 'TOP:lost', label: 'Top 1 em Lost', position: 1, style: 'gold' },
      { group: 'ranking', hint: 'Chegue a Ouro neste tema', id: 'T:lost:TIER_GOLD', label: 'Ouro em Lost', style: 'rank' },
      { group: 'feitos', hint: 'Conquista geral', id: 'G:STREAK_7', label: 'Chama acesa', style: 'feat' },
      {
        group: 'feitos',
        hint: 'Vença 10 Rankeadas seguidas',
        id: 'T:lost:WIN_STREAK_10',
        label: 'Imparável em Lost',
        locked: { ratio: 0.7, text: '7 de 10 vitórias seguidas' },
        style: 'feat',
      },
    ],
    ...overrides,
  };
}

describe('vitrine de títulos', () => {
  afterEach(() => {
    cleanup();
    mocks.apiRequest.mockReset();
  });

  it('mostra a prévia, os destaques, o "Quase lá" e equipa com um toque', async () => {
    mocks.apiRequest.mockResolvedValueOnce(showcase());
    const onCurrentChange = vi.fn();
    render(<TitleShowcase onCurrentChange={onCurrentChange} viewer={viewer} />);

    expect(await screen.findByRole('heading', { name: '3 de 20' })).toBeInTheDocument();
    expect(onCurrentChange).toHaveBeenCalledWith({ label: 'Top 1 em Lost', position: 1, style: 'gold' });
    expect(screen.getByText('Quase lá')).toBeInTheDocument();
    expect(screen.getAllByText('7 de 10 vitórias seguidas').length).toBeGreaterThan(0);
    // O destaque aparece na vitrine e a estrela do cartão fica marcada.
    expect(screen.getAllByRole('button', { name: 'Tirar Top 1 em Lost dos destaques' })).toHaveLength(2);
    expect(screen.getByText('✓ Em uso')).toBeInTheDocument();

    mocks.apiRequest.mockResolvedValueOnce(showcase({
      current: { label: 'Ouro em Lost', style: 'rank' }, equippedId: 'T:lost:TIER_GOLD',
    }));
    fireEvent.click(screen.getByRole('button', { name: /^Ouro em Lost/ }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/profile/titles', expect.objectContaining({
      body: { equippedId: 'T:lost:TIER_GOLD' }, method: 'PUT',
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: /Em uso.*Ouro em Lost/, pressed: true })).toBeInTheDocument());
  });

  it('não deixa passar de três destaques e explica por quê', async () => {
    mocks.apiRequest.mockResolvedValueOnce(showcase({ pins: ['TOP:lost', 'T:lost:TIER_GOLD', 'G:STREAK_7'] }));
    render(<TitleShowcase viewer={viewer} />);
    await screen.findByRole('heading', { name: '3 de 20' });
    expect(screen.queryByText('Destaque com a estrela')).not.toBeInTheDocument();
    // Título bloqueado não tem estrela nem botão de equipar.
    expect(screen.queryByRole('button', { name: /^Imparável em Lost/ })).not.toBeInTheDocument();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
  });

  it('escolher um título bloqueado como objetivo e vê-lo no topo', async () => {
    mocks.apiRequest.mockResolvedValueOnce(showcase());
    render(<TitleShowcase viewer={viewer} />);
    await screen.findByRole('heading', { name: '3 de 20' });
    const goal = { ...showcase().titles[3]! };
    mocks.apiRequest.mockResolvedValueOnce(showcase({ goal }));
    fireEvent.click(screen.getByRole('button', { name: 'Quero este' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenLastCalledWith('/api/profile/titles', expect.objectContaining({
      body: { goalId: 'T:lost:WIN_STREAK_10' }, method: 'PUT',
    })));
    expect(await screen.findByText('Seu objetivo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '★ Seu objetivo' })).toBeDisabled();
  });

  it('sem nenhuma Rankeada, convida para a primeira', async () => {
    mocks.apiRequest.mockResolvedValueOnce(showcase({
      current: null, owned: 0, pins: [], possible: 1,
      titles: [{ group: 'feitos', hint: 'Chegue ao nível 5', id: 'N:5', label: 'Curioso', locked: { ratio: 0, text: 'faltam 415 de XP' }, style: 'feat' }],
    }));
    render(<TitleShowcase viewer={viewer} />);
    expect(await screen.findByRole('heading', { name: 'Seu primeiro título está perto' })).toBeInTheDocument();
  });
});

describe('resultado: Top e títulos novos', () => {
  afterEach(() => cleanup());

  it('mostra o título sob o nome, a nova posição e os títulos liberados', () => {
    render(<MatchResultScreen
      knowledgeAfter={950}
      knowledgeDelta={75}
      onBack={() => undefined}
      opponent={{ name: 'Ana', result: 'LOSS', score: 40, title: { label: 'Top 2 em Lost', style: 'silver' } }}
      ranked
      themeRewards={{
        achievements: [{ id: 'FIRST_WIN', title: 'Estreou vencendo em Lost' }],
        themeName: 'Lost',
        top: { after: 1, before: 2 },
      }}
      viewer={{ name: 'Gomes', result: 'WIN', score: 90 }}
      xpDelta={100}
    />);
    expect(screen.getByText('Top 2 em Lost')).toBeInTheDocument();
    expect(screen.getByText('Você é o Top 1 em Lost')).toBeInTheDocument();
    expect(screen.getByText('Título novo')).toBeInTheDocument();
    expect(screen.getByText('Estreou vencendo em Lost')).toBeInTheDocument();
  });

  it('sair do Top é dito como fato, sem enfeite', () => {
    render(<MatchResultScreen
      knowledgeAfter={800}
      knowledgeDelta={-30}
      onBack={() => undefined}
      opponent={{ name: 'Ana', result: 'WIN', score: 90 }}
      ranked
      themeRewards={{ achievements: [], themeName: 'Lost', top: { after: null, before: 10 } }}
      viewer={{ name: 'Gomes', result: 'LOSS', score: 40 }}
      xpDelta={20}
    />);
    expect(screen.getByText('Você saiu do Top 10 em Lost')).toBeInTheDocument();
    expect(screen.queryByText('Título novo')).not.toBeInTheDocument();
  });
});
