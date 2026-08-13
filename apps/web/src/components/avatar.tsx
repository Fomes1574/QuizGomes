import { useState } from 'react';

export function resolveAvatarSource(
  customUrl?: string | null,
  googleUrl?: string | null,
  failed: ReadonlySet<string> = new Set(),
): string | null {
  for (const candidate of [customUrl, googleUrl]) {
    if (candidate !== undefined && candidate !== null && !failed.has(candidate)) return candidate;
  }
  return null;
}

export function Avatar({ customUrl, googleUrl, name, size = 'medium' }: {
  customUrl?: string | null | undefined;
  googleUrl?: string | null | undefined;
  name: string;
  size?: 'large' | 'medium' | 'small';
}) {
  const sourcesKey = `${customUrl ?? ''}\u0000${googleUrl ?? ''}`;
  const [failureState, setFailureState] = useState<{
    key: string;
    sources: ReadonlySet<string>;
  }>(() => ({ key: sourcesKey, sources: new Set() }));
  const source = failureState.key === sourcesKey
    ? resolveAvatarSource(customUrl, googleUrl, failureState.sources)
    : resolveAvatarSource(customUrl, googleUrl);
  const initial = name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';
  return (
    <span className={`avatar avatar--${size}`} aria-label={`Foto de ${name}`}>
      {source === null
        ? <span aria-hidden="true">{initial}</span>
        : <img
            alt=""
            onError={() => setFailureState((current) => ({
              key: sourcesKey,
              sources: new Set([...(current.key === sourcesKey ? current.sources : []), source]),
            }))}
            referrerPolicy="no-referrer"
            src={source}
          />}
    </span>
  );
}
