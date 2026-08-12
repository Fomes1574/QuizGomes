import type { StandardThemeIconKey } from '@quiz-gomes/domain';

export function ThemeIcon({ className, iconKey }: { className?: string; iconKey: StandardThemeIconKey }) {
  return (
    <svg aria-hidden="true" className={className} focusable="false" viewBox="0 0 24 24">
      <use href={`/theme-icons.svg#${iconKey}`} />
    </svg>
  );
}
