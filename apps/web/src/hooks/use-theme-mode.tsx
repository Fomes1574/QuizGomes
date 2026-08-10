import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeModeValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = 'quiz-gomes:theme-mode';
const ThemeModeContext = createContext<ThemeModeValue | null>(null);

function storedMode(): ThemeMode {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function systemTheme(): ResolvedTheme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = mode === 'system' ? system : mode;

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystem(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const value = useMemo<ThemeModeValue>(() => ({
    mode,
    resolved,
    setMode: (nextMode) => {
      localStorage.setItem(STORAGE_KEY, nextMode);
      setModeState(nextMode);
    },
  }), [mode, resolved]);

  return <ThemeModeContext value={value}>{children}</ThemeModeContext>;
}

export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (value === null) throw new Error('useThemeMode precisa de ThemeModeProvider.');
  return value;
}
