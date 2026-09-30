import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface ThemePickerOption {
  categoryName: string;
  id: string;
  /** Texto curto opcional ao lado do nome (ex.: "Desativado"). */
  note?: string;
  name: string;
}

function normalized(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

/**
 * Seletor de tema com busca. Substitui o <select> nativo, que crescia com o
 * catálogo inteiro: aqui a lista tem altura fixa com rolagem, vem agrupada
 * por categoria e filtra por nome ou categoria enquanto se digita (sem
 * diferenciar acento). Teclado: ↑/↓ navegam, Enter escolhe, Esc fecha.
 */
export function ThemePicker({
  disabled = false,
  emptyLabel = 'Nenhum tema encontrado.',
  label = 'Tema',
  onChange,
  options,
  placeholder = 'Buscar e escolher um tema',
  value,
}: {
  disabled?: boolean;
  emptyLabel?: string;
  label?: string;
  onChange: (id: string) => void;
  options: ThemePickerOption[];
  placeholder?: string;
  value: string;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.id === value) ?? null;

  const filtered = useMemo(() => {
    const needle = normalized(query.trim());
    const matches = needle === ''
      ? options
      : options.filter((option) => normalized(`${option.name} ${option.categoryName}`).includes(needle));
    return [...matches].sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'pt-BR')
      || a.name.localeCompare(b.name, 'pt-BR'));
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function openList() {
    if (disabled) return;
    setQuery('');
    const selectedIndex = [...options]
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))
      .findIndex((option) => option.id === value);
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(option: ThemePickerOption) {
    onChange(option.id);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openList(); return; }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => Math.min(Math.max(0, current + step), Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option !== undefined) choose(option);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  const activeOption = open ? filtered[activeIndex] : undefined;

  return (
    <div className={`theme-picker${open ? ' theme-picker--open' : ''}`} ref={rootRef}>
      <label className="theme-picker__label" htmlFor={`${baseId}-input`}>{label}</label>
      <div className="theme-picker__control">
        <input
          aria-activedescendant={activeOption === undefined ? undefined : `${baseId}-option-${activeOption.id}`}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          autoComplete="off"
          disabled={disabled}
          id={`${baseId}-input`}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); if (!open) setOpen(true); }}
          onClick={() => { if (!open) openList(); }}
          onFocus={() => { if (!open) openList(); }}
          onKeyDown={onKeyDown}
          placeholder={selected === null ? placeholder : `${selected.name} · ${selected.categoryName}`}
          role="combobox"
          type="text"
          value={open ? query : selected === null ? '' : `${selected.name} · ${selected.categoryName}`}
        />
        <span aria-hidden="true" className="theme-picker__chevron">▾</span>
      </div>
      {open ? (
        <ul aria-label={label} className="theme-picker__list" id={listId} ref={listRef} role="listbox">
          {filtered.length === 0 ? <li className="theme-picker__empty" role="presentation">{emptyLabel}</li> : null}
          {filtered.map((option, index) => {
            const header = option.categoryName !== filtered[index - 1]?.categoryName
              ? <li aria-hidden="true" className="theme-picker__group" key={`group-${option.categoryName}`}>{option.categoryName}</li>
              : null;
            return [
              header,
              <li
                aria-selected={option.id === value}
                className={`theme-picker__option${index === activeIndex ? ' theme-picker__option--active' : ''}`}
                data-index={index}
                id={`${baseId}-option-${option.id}`}
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
              >
                <span>{option.name}</span>
                {option.note === undefined ? null : <small>{option.note}</small>}
                {option.id === value ? <span aria-hidden="true" className="theme-picker__check">✓</span> : null}
              </li>,
            ];
          })}
        </ul>
      ) : null}
    </div>
  );
}
