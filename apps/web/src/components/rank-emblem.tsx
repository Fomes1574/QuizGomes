import type { Tier } from '@quiz-gomes/domain';
import { useId } from 'react';

/**
 * Selo de cada liga: a silhueta muda de liga para liga (moeda, escudo,
 * estrela, hexágono, gema, coroa), então dá para reconhecer o tier mesmo em
 * tamanho pequeno ou sem enxergar a cor. A cor vem de `--rank`, definida
 * pela classe da liga no elemento pai.
 */
const SHAPES: Record<Tier, { body: string; mark: string }> = {
  // Moeda de latão.
  Latão: {
    body: 'M20 4a18 18 0 1 0 0 36a18 18 0 1 0 0-36Z',
    mark: 'M20 11a11 11 0 1 0 0 22a11 11 0 1 0 0-22Zm0 3.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15Z',
  },
  // Escudo com uma divisa.
  Bronze: {
    body: 'M20 3 35 9v13c0 9.5-6.3 15.6-15 19-8.7-3.4-15-9.5-15-19V9L20 3Z',
    mark: 'M11 19l9 6 9-6v4.5l-9 6-9-6V19Z',
  },
  // Escudo com divisa dupla.
  Prata: {
    body: 'M20 3 35 9v13c0 9.5-6.3 15.6-15 19-8.7-3.4-15-9.5-15-19V9L20 3Z',
    mark: 'M11 17l9 6 9-6v4l-9 6-9-6v-4Zm0 7l9 6 9-6v4l-9 6-9-6v-4Z',
  },
  // Estrela.
  Ouro: {
    body: 'M20 2l5.3 11.6 12.7 1.4-9.5 8.6 2.7 12.5L20 29.7 8.8 36.1l2.7-12.5L2 15l12.7-1.4L20 2Z',
    mark: 'M20 12l2.6 5.6 6.1.7-4.6 4.1 1.3 6L20 25.3l-5.4 3.1 1.3-6-4.6-4.1 6.1-.7L20 12Z',
  },
  // Hexágono lapidado.
  Platina: {
    body: 'M20 2l16 9.2v19.6L20 40 4 30.8V11.2L20 2Z',
    mark: 'M20 10l9.5 5.5v11L20 32l-9.5-5.5v-11L20 10Z',
  },
  // Gema com facetas.
  Diamante: {
    body: 'M10 6h20l8 10-18 24L2 16l8-10Z',
    mark: 'M2 16h36M10 6l6 10 4 24 4-24 6-10M16 16l4-10 4 10',
  },
  // Coroa.
  Mestre: {
    body: 'M4 13l8 7 8-14 8 14 8-7-3 22H7L4 13Z',
    mark: 'M8 31h24v4H8z',
  },
  // Coroa em chamas com joia.
  Desafiante: {
    body: 'M4 15l8 6 8-17 8 17 8-6-3 21H7L4 15Z',
    mark: 'M20 20.5l3 4-3 4-3-4 3-4ZM8 32h24v4H8z',
  },
};

export function RankEmblem({ tier }: { tier: Tier }) {
  const shape = SHAPES[tier];
  const facets = tier === 'Diamante';
  const shineId = `rank-shine-${useId().replace(/:/g, '')}`;
  return (
    <svg aria-hidden="true" className="rank-emblem" data-tier={tier} viewBox="0 0 40 44">
      <defs>
        <linearGradient id={shineId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="rank-emblem__body" d={shape.body} />
      <path d={shape.body} fill={`url(#${shineId})`} />
      {facets
        ? <path className="rank-emblem__facets" d={shape.mark} />
        : <path className="rank-emblem__mark" d={shape.mark} fillRule="evenodd" />}
    </svg>
  );
}
