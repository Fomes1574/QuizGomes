import { useState } from 'react';
import type { ThemeArtwork as ThemeArtworkModel } from '@quiz-gomes/domain';
import { ThemeIcon } from './theme-icon.js';

const loadedArtworkUrls = new Set<string>();

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const value = words.length > 1
    ? `${Array.from(words[0] ?? '')[0] ?? ''}${Array.from(words[1] ?? '')[0] ?? ''}`
    : Array.from(words[0] ?? '').slice(0, 2).join('');
  return value.toLocaleUpperCase('pt-BR') || 'QG';
}

export function ThemeArtwork({
  artwork,
  className = '',
  decorative = true,
  eager = false,
  name,
}: {
  artwork: ThemeArtworkModel;
  className?: string;
  decorative?: boolean;
  eager?: boolean;
  name: string;
}) {
  const customUrl = artwork.kind === 'CUSTOM' ? artwork.url : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const customAvailable = customUrl !== null && failedUrl !== customUrl;
  const customLoaded = customUrl !== null && (loadedUrl === customUrl || loadedArtworkUrls.has(customUrl));
  const accessibility = decorative
    ? { 'aria-hidden': true as const }
    : { 'aria-label': `Arte do tema ${name}`, role: 'img' as const };

  return (
    <span className={`theme-artwork ${className}`.trim()} {...accessibility}>
      <span className="theme-artwork__fallback">
        {artwork.kind === 'ICON'
          ? <ThemeIcon className="theme-artwork__icon" iconKey={artwork.iconKey} />
          : <span className="theme-artwork__initials">{initials(name)}</span>}
      </span>
      {customAvailable ? (
        <img
          alt=""
          className={customLoaded ? 'theme-artwork__image theme-artwork__image--loaded' : 'theme-artwork__image'}
          decoding="async"
          height="512"
          loading={eager || loadedArtworkUrls.has(customUrl) ? 'eager' : 'lazy'}
          onError={() => setFailedUrl(customUrl)}
          onLoad={() => {
            loadedArtworkUrls.add(customUrl);
            setLoadedUrl(customUrl);
          }}
          src={customUrl}
          width="512"
        />
      ) : null}
    </span>
  );
}
