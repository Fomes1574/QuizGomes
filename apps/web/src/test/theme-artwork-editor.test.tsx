// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeArtworkEditor, { type ThemeArtworkDraft } from '../components/theme-artwork-editor.js';

function ControlledEditor() {
  const [value, setValue] = useState<ThemeArtworkDraft>({ kind: 'NONE' });
  return <ThemeArtworkEditor currentArtwork={{ kind: 'NONE', version: 0 }} name="Tema sintético" onChange={setValue} value={value} />;
}

describe('editor ADMIN de arte dos temas', () => {
  afterEach(() => cleanup());

  it('oferece exatamente os três modos e uma grade vetorial selecionável', () => {
    render(<ControlledEditor />);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Ícone padrão' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(16);
    fireEvent.click(screen.getByRole('button', { name: 'Ciência' }));
    expect(screen.getByRole('button', { name: 'Ciência' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('use[href="/theme-icons.svg#science"]')).toBeInTheDocument();
  });

  it('rejeita SVG do usuário antes do processamento', () => {
    render(<ControlledEditor />);
    fireEvent.click(screen.getByRole('radio', { name: 'Imagem personalizada' }));
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input as Element, {
      target: { files: [new File(['<svg/>'], 'tema.svg', { type: 'image/svg+xml' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('SVG enviado pelo usuário não é aceito.');
  });
});
