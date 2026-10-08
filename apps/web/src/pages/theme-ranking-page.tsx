import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorState } from '../components/async-state.js';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { Icon } from '../components/icons.js';
import { RankBadge } from '../components/rank-badge.js';
import { RankingListSkeleton } from '../components/skeletons.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest } from '../lib/api.js';
import { playerPath } from '../lib/invite-link.js';

export interface RankingEntry {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  knowledge: number;
  photoUrl: string | null;
  position: number;
  publicId: string;
  self: boolean;
}

interface RankingResponse {
  around?: { entries: RankingEntry[]; positionCapped: boolean } | null;
  entries: RankingEntry[];
  theme: { name: string; slug: string };
}

type Scope = 'friends' | 'top';

function RankingRow({ entry, capped = false }: { capped?: boolean; entry: RankingEntry }) {
  const podium = entry.position <= 3 ? ` ranking-row--p${entry.position}` : '';
  const content = (
    <>
      <span className="ranking-row__position">{capped && entry.self ? '10.000+' : entry.position}</span>
      <AvatarFrame frameId={entry.frameId}>
        <Avatar customUrl={entry.customAvatarUrl} googleUrl={entry.photoUrl} name={entry.displayName} size="small" />
      </AvatarFrame>
      <span className="ranking-row__name">
        <strong>{entry.self ? 'Você' : entry.displayName}</strong>
        <small>{entry.knowledge.toLocaleString('pt-BR')} de Conhecimento</small>
      </span>
      <RankBadge knowledge={entry.knowledge} />
    </>
  );
  return (
    <li className={`ranking-row${entry.self ? ' ranking-row--self' : ''}${podium}`}>
      <Link aria-label={entry.self ? 'Seu perfil' : `Perfil de ${entry.displayName}`} to={entry.self ? '/perfil' : playerPath(entry.publicId)}>
        {content}
      </Link>
    </li>
  );
}

/**
 * Ranking completo do tema: os 100 primeiros e, para quem está mais abaixo,
 * a própria posição com os vizinhos. A aba Amigos mostra só a sua roda.
 */
export function ThemeRankingPage() {
  const { slug = '' } = useParams();
  const { getToken, profile } = useAuth();
  const [scope, setScope] = useState<Scope>('top');
  const [attempt, setAttempt] = useState(0);
  // Resposta guardada junto com o pedido que a gerou: trocar de aba mostra
  // "carregando" na hora, sem apagar estado dentro do efeito.
  const requestKey = `${slug}|${scope}|${attempt}|${profile?.userId ?? ''}`;
  const [result, setResult] = useState<{ data?: RankingResponse; error?: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    const path = `/api/themes/${encodeURIComponent(slug)}/ranking${scope === 'friends' ? '?scope=friends' : ''}`;
    void apiRequest<RankingResponse>(path, profile === null ? {} : { getToken })
      .then((response) => { if (active) setResult({ data: response, key: requestKey }); })
      .catch((reason: unknown) => {
        if (active) setResult({ error: reason instanceof Error ? reason.message : 'Não deu para abrir o ranking.', key: requestKey });
      });
    return () => { active = false; };
  }, [getToken, profile, requestKey, scope, slug]);

  const current = result?.key === requestKey ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const friendsOnlyMe = scope === 'friends' && data !== null && data.entries.every((entry) => entry.self);

  return (
    <section className="page page--narrow ranking-page">
      <Link className="ranking-page__back" to={`/temas/${encodeURIComponent(slug)}`}><Icon name="back" />{data?.theme.name ?? 'Voltar ao tema'}</Link>
      <header className="ranking-page__head">
        <span className="eyebrow">Ranking</span>
        <h1>{data?.theme.name ?? 'Ranking do tema'}</h1>
        <p>Só a Rankeada conta. Empate divide a posição.</p>
      </header>
      {profile !== null && (
        <div aria-label="Quem aparece" className="segmented segmented--wide ranking-page__tabs" role="radiogroup">
          {([['top', 'Top 100'], ['friends', 'Amigos']] as const).map(([value, label]) => (
            <button aria-checked={scope === value} className={scope === value ? 'segmented__active' : ''} key={value} onClick={() => setScope(value)} role="radio" type="button">{label}</button>
          ))}
        </div>
      )}
      {error !== null ? <ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} />
        : data === null ? <RankingListSkeleton />
          : data.entries.length === 0 ? (
            <p className="ranking-page__empty">{scope === 'friends'
              ? 'Nem você nem seus amigos pontuaram aqui ainda. Uma Rankeada já coloca seu nome na lista.'
              : 'Ninguém pontuou neste tema ainda. A primeira Rankeada abre a lista.'}</p>
          ) : (
            <>
              <ol className="ranking-list">
                {data.entries.map((entry) => <RankingRow entry={entry} key={entry.publicId} />)}
              </ol>
              {data.around != null && data.around.entries.length > 0 && (
                <>
                  <p aria-hidden="true" className="ranking-list__gap">⋯</p>
                  <ol className="ranking-list" aria-label="Sua posição">
                    {data.around.entries.map((entry) => <RankingRow capped={data.around?.positionCapped === true} entry={entry} key={entry.publicId} />)}
                  </ol>
                </>
              )}
              {friendsOnlyMe && (
                <p className="ranking-page__empty">Seus amigos ainda não jogaram Rankeada aqui. Chama alguém pra disputar com você.</p>
              )}
            </>
          )}
    </section>
  );
}

export default ThemeRankingPage;
