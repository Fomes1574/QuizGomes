// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeArtwork } from '../components/theme-artwork.js';
import { MatchmakingDialog } from '../components/matchmaking-dialog.js';

describe('componente central de arte do tema', () => {
  afterEach(() => cleanup());

  it('resolve ícone padrão pelo sprite vetorial reutilizável', () => {
    render(<ThemeArtwork artwork={{ iconKey: 'science', kind: 'ICON', version: 2 }} decorative={false} name="Ciência" />);

    expect(screen.getByRole('img', { name: 'Arte do tema Ciência' })).toBeInTheDocument();
    expect(document.querySelector('use')).toHaveAttribute('href', '/theme-icons.svg#science');
    expect(screen.queryByText('CI')).not.toBeInTheDocument();
  });

  it('mantém iniciais por baixo, não mostra imagem quebrada e conhece suas dimensões', () => {
    render(<ThemeArtwork artwork={{ kind: 'CUSTOM', url: '/api/theme-artwork/theme/v3.webp', version: 3 }} name="Elden Ring" />);

    const image = document.querySelector('.theme-artwork__image');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('width', '512');
    expect(image).toHaveAttribute('height', '512');
    expect(screen.getByText('ER')).toBeInTheDocument();

    fireEvent.error(image as Element);
    expect(document.querySelector('.theme-artwork__image')).not.toBeInTheDocument();
    expect(screen.getByText('ER')).toBeInTheDocument();
  });

  it('reutiliza em memória uma URL já carregada e evita uma segunda espera visual', () => {
    const url = '/api/theme-artwork/cache-test/v7.webp';
    const first = render(<ThemeArtwork artwork={{ kind: 'CUSTOM', url, version: 7 }} name="Games" />);
    const firstImage = first.container.querySelector('img');
    fireEvent.load(firstImage as Element);
    expect(firstImage).toHaveClass('theme-artwork__image--loaded');
    first.unmount();

    render(<ThemeArtwork artwork={{ kind: 'CUSTOM', url, version: 7 }} name="Games" />);
    expect(document.querySelector('img')).toHaveClass('theme-artwork__image--loaded');
    expect(document.querySelector('img')).toHaveAttribute('loading', 'eager');
  });

  it('usa iniciais como fallback definitivo quando não há arte configurada', () => {
    render(<ThemeArtwork artwork={{ kind: 'NONE', version: 0 }} decorative={false} name="O Senhor dos Anéis" />);
    expect(screen.getByText('OS')).toBeInTheDocument();
  });

  it('leva a mesma arte já conhecida ao matchmaking sem voltar ao logo genérico', () => {
    render(<MatchmakingDialog
      onCancel={() => undefined}
      onClose={() => undefined}
      status="searching"
      theme={{
        activeQuestionCount: 30,
        artwork: { iconKey: 'games', kind: 'ICON', version: 1 },
        categoryId: 'games',
        categoryName: 'Games',
        coverImageKey: null,
        description: 'Fixture sintética.',
        id: 'theme-games',
        name: 'Games em Geral',
        slug: 'games-em-geral',
      }}
    />);

    expect(document.querySelector('.matchmaking-theme-artwork use')).toHaveAttribute('href', '/theme-icons.svg#games');
    expect(screen.getByText('Games em Geral')).toBeInTheDocument();
    expect(screen.queryByText('QUIZ GOMES')).not.toBeInTheDocument();
  });
});
