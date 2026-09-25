import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { themeLinkPreview } from '../http/link-preview.js';

const SHELL = `<!doctype html><html><head>
<meta name="description" content="padrão" />
<meta property="og:title" content="QUIZ GOMES" />
<meta property="og:description" content="padrão" />
<meta property="og:image" content="/icons/icon-512.webp" />
<meta property="og:url" content="/" />
<meta name="twitter:title" content="QUIZ GOMES" />
<title>QUIZ GOMES</title></head><body><div id="root"></div></body></html>`;

function withShell(): typeof env {
  return {
    ...env,
    ASSETS: { fetch: () => Promise.resolve(new Response(SHELL, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"x"' } })) } as unknown as Fetcher,
  };
}

describe('prévia de link do tema', () => {
  it('reescreve título e Open Graph com dados do tema, com escape', async () => {
    const prefix = `lp-${crypto.randomUUID().slice(0, 6)}`;
    await env.CORE_DB.batch([
      env.CORE_DB.prepare('INSERT INTO categories (id, slug, name, sort_order) VALUES (?1, ?1, ?2, 999)').bind(`${prefix}-cat`, `Cat ${prefix}`),
      env.CORE_DB.prepare(
        `INSERT INTO themes (id, category_id, slug, name, description, status, origin, question_shard_id)
         VALUES (?1, ?2, ?1, ?3, ?4, 'ACTIVE', 'OFFICIAL', 'questions-01')`,
      ).bind(prefix, `${prefix}-cat`, `Rock & "Metal" ${prefix}`, 'Riffs <b>pesados</b>.'),
    ]);
    const url = new URL(`https://quiz.test/temas/${prefix}?jogar=rankeada`);
    const response = await themeLinkPreview(new Request(url), withShell(), url);
    expect(response).not.toBeNull();
    const html = await response!.text();
    expect(html).toContain(`<title>Bora uma rankeada de Rock &amp; "Metal" ${prefix}? · QUIZ GOMES</title>`);
    expect(html).toContain(`content="Bora uma rankeada de Rock & &quot;Metal&quot; ${prefix}? · QUIZ GOMES"`);
    expect(html).toContain(`content="https://quiz.test/temas/${prefix}?jogar=rankeada"`);
    expect(html).toContain('content="https://quiz.test/icons/icon-512.webp"');
    // Dentro de atributo entre aspas, "<" é texto inerte; aspas são escapadas acima.
    expect(html).toContain('content="Entra na fila comigo: 10 segundos por pergunta, sem desempate. Riffs <b>pesados</b>."');
    expect(html).not.toContain('<b>pesados</b>.</');
    expect(response!.headers.get('Cache-Control')).toBe('no-cache');
    expect(response!.headers.get('ETag')).toBeNull();
  });

  it('tema inexistente ou rota que não é de tema devolvem a página intacta', async () => {
    const missing = new URL('https://quiz.test/temas/nao-existe-mesmo');
    const response = await themeLinkPreview(new Request(missing), withShell(), missing);
    expect(await response!.text()).toContain('<title>QUIZ GOMES</title>');
    const other = new URL('https://quiz.test/social');
    expect(await themeLinkPreview(new Request(other), withShell(), other)).toBeNull();
  });
});
