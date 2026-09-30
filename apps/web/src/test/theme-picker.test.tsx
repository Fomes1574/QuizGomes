// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ThemePicker } from '../components/theme-picker.js';

const options = [
  { categoryName: 'Animes', id: 'naruto', name: 'Naruto' },
  { categoryName: 'Escola', id: 'historia', name: 'História' },
  { categoryName: 'Animes', id: 'one-piece', name: 'One Piece' },
  { categoryName: 'Escola', id: 'geo', name: 'Geografia', note: 'Desativado' },
];

describe('seletor de tema com busca', () => {
  beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(cleanup);

  it('agrupa por categoria em ordem e filtra sem diferenciar acento', () => {
    render(<ThemePicker onChange={vi.fn()} options={options} value="" />);
    const input = screen.getByRole('combobox', { name: 'Tema' });
    fireEvent.focus(input);
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map((item) => item.textContent)).toEqual([
      'Naruto', 'One Piece', 'GeografiaDesativado', 'História',
    ]);
    expect(list).toHaveTextContent('Animes');
    expect(list).toHaveTextContent('Escola');

    fireEvent.change(input, { target: { value: 'historia' } });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(within(list).getByRole('option')).toHaveTextContent('História');

    fireEvent.change(input, { target: { value: 'escola' } });
    expect(within(list).getAllByRole('option')).toHaveLength(2);

    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(list).toHaveTextContent('Nenhum tema encontrado.');
  });

  it('escolhe pelo teclado e mostra o tema escolhido quando fecha', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ThemePicker onChange={onChange} options={options} value="" />);
    const input = screen.getByRole('combobox', { name: 'Tema' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('one-piece');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    rerender(<ThemePicker onChange={onChange} options={options} value="one-piece" />);
    expect(input).toHaveValue('One Piece · Animes');

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clique numa opção escolhe e fecha', () => {
    const onChange = vi.fn();
    render(<ThemePicker onChange={onChange} options={options} value="" />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Tema' }));
    fireEvent.click(screen.getByRole('option', { name: 'Naruto' }));
    expect(onChange).toHaveBeenCalledWith('naruto');
  });
});
