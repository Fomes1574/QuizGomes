export const STANDARD_THEME_ICONS = [
  { key: 'games', label: 'Games' },
  { key: 'movies', label: 'Filmes' },
  { key: 'series', label: 'Séries' },
  { key: 'music', label: 'Música' },
  { key: 'science', label: 'Ciência' },
  { key: 'history', label: 'História' },
  { key: 'geography', label: 'Geografia' },
  { key: 'football', label: 'Futebol' },
  { key: 'sports', label: 'Esportes' },
  { key: 'books', label: 'Livros' },
  { key: 'art', label: 'Arte' },
  { key: 'nature', label: 'Natureza' },
  { key: 'fantasy', label: 'Fantasia' },
  { key: 'technology', label: 'Tecnologia' },
  { key: 'food', label: 'Gastronomia' },
  { key: 'general', label: 'Geral' },
] as const;

export type StandardThemeIconKey = (typeof STANDARD_THEME_ICONS)[number]['key'];

export type ThemeArtwork =
  | { iconKey: StandardThemeIconKey; kind: 'ICON'; version: number }
  | { kind: 'CUSTOM'; url: string; version: number }
  | { kind: 'NONE'; version: number };

const STANDARD_THEME_ICON_KEYS = new Set<string>(STANDARD_THEME_ICONS.map(({ key }) => key));

export function isStandardThemeIconKey(value: string): value is StandardThemeIconKey {
  return STANDARD_THEME_ICON_KEYS.has(value);
}
