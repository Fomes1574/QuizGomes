import type { Env } from '../env.js';

const THEME_PATH = /^\/temas\/([a-z0-9_-]{1,128})\/?$/i;
const SITE_DESCRIPTION = 'Quiz competitivo em tempo real: escolha um tema e prove quem manja mais.';

interface PreviewTheme {
  artwork_kind: string;
  artwork_version: number;
  description: string;
  id: string;
  name: string;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Prévia de link (WhatsApp, Telegram, Discord…) para a página de um tema.
 * Os robôs não rodam JavaScript, então o Worker reescreve só as metatags do
 * index.html da SPA. Qualquer falha devolve a página original sem prévia.
 */
export async function themeLinkPreview(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const slug = THEME_PATH.exec(url.pathname)?.[1];
  if (slug === undefined) return null;
  const page = await env.ASSETS.fetch(request);
  if (!page.ok || !(page.headers.get('Content-Type') ?? '').includes('text/html')) return page;
  let theme: PreviewTheme | null;
  try {
    theme = await env.CORE_DB.prepare(
      `SELECT id, name, description, artwork_kind, artwork_version
         FROM themes WHERE slug = ?1 AND status = 'ACTIVE'`,
    ).bind(slug.toLowerCase()).first<PreviewTheme>();
  } catch {
    return page;
  }
  if (theme === null) return page;

  const invite = url.searchParams.get('jogar');
  const title = invite === 'rankeada'
    ? `Bora uma rankeada de ${theme.name}? · QUIZ GOMES`
    : invite === 'normal'
      ? `Bora uma partida de ${theme.name}? · QUIZ GOMES`
      : `${theme.name} · QUIZ GOMES`;
  const description = truncate(
    invite === null
      ? (theme.description.trim() === '' ? SITE_DESCRIPTION : theme.description)
      : `Entra na fila comigo: 10 segundos por pergunta, sem desempate. ${theme.description}`,
    200,
  );
  const image = theme.artwork_kind === 'CUSTOM' && theme.artwork_version > 0
    ? new URL(`/api/theme-artwork/${encodeURIComponent(theme.id)}/v${theme.artwork_version}.webp`, url.origin).toString()
    : new URL('/icons/icon-512.webp', url.origin).toString();
  const canonical = new URL(`/temas/${encodeURIComponent(slug.toLowerCase())}`, url.origin);
  if (invite === 'normal' || invite === 'rankeada') canonical.searchParams.set('jogar', invite);

  const properties: Record<string, string> = {
    'og:description': description,
    'og:image': image,
    'og:title': title,
    'og:url': canonical.toString(),
  };
  const names: Record<string, string> = {
    description,
    'twitter:description': description,
    'twitter:image': image,
    'twitter:title': title,
  };
  const response = new HTMLRewriter()
    .on('title', { element: (element) => { element.setInnerContent(title); } })
    .on('meta[property]', {
      element: (element) => {
        const value = properties[element.getAttribute('property') ?? ''];
        if (value !== undefined) element.setAttribute('content', value);
      },
    })
    .on('meta[name]', {
      element: (element) => {
        const value = names[element.getAttribute('name') ?? ''];
        if (value !== undefined) element.setAttribute('content', value);
      },
    })
    .transform(page);
  const headers = new Headers(response.headers);
  // A prévia muda com o tema: nunca servir a de outro tema de um cache.
  headers.set('Cache-Control', 'no-cache');
  headers.delete('ETag');
  headers.delete('Content-Length');
  return new Response(response.body, { headers, status: response.status });
}
