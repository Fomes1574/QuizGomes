import { useEffect, useState, type CSSProperties } from 'react';
import type { PlayerTitle } from '@quiz-gomes/domain';
import { useAuth } from '../features/auth-context.js';
import { apiRequest } from '../lib/api.js';
import { titleGlyph, type ShowcaseTitle, type TitleShowcaseData } from '../lib/titles.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Icon } from './icons.js';
import { PlayerTitleText } from './player-title.js';
import { RankEmblem } from './rank-emblem.js';

const FILTERS = [['todos', 'Todos'], ['top', 'Top'], ['ranking', 'Ranking'], ['feitos', 'Feitos']] as const;
type Filter = (typeof FILTERS)[number][0];
const MAX_PINS = 3;

interface Viewer {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
}

function Glyph({ title }: { title: ShowcaseTitle }) {
  const glyph = titleGlyph(title);
  if (glyph.kind === 'tier') return <span className="title-slot__emblem"><RankEmblem tier={glyph.tier} /></span>;
  if (glyph.kind === 'icon') return <Icon className="title-slot__icon" name={glyph.name} />;
  return <span className="title-slot__number">{glyph.value}</span>;
}

/**
 * Vitrine do Perfil: escolher o título que aparece sob o nome, destacar até
 * três e ver o que está quase saindo. Um toque equipa; o servidor confere
 * tudo de novo.
 */
export function TitleShowcase({ onCurrentChange, viewer }: {
  onCurrentChange?: (title: PlayerTitle | null) => void;
  viewer: Viewer;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<TitleShowcaseData | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('todos');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlayerTitle | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void apiRequest<TitleShowcaseData>('/api/profile/titles', { getToken })
      .then((response) => {
        if (!active) return;
        // Resposta fora do formato: a vitrine some em vez de quebrar o Perfil.
        if (Array.isArray(response?.titles) && Array.isArray(response.pins)) setData(response);
        else setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [getToken]);

  useEffect(() => {
    if (data !== null) onCurrentChange?.(data.current);
  }, [data, onCurrentChange]);

  async function save(body: { autoTop?: boolean; equippedId?: string | null; pins?: string[] }, optimistic?: PlayerTitle | null) {
    setBusy(true);
    setMessage(null);
    if (optimistic !== undefined) setPreview(optimistic);
    try {
      const response = await apiRequest<TitleShowcaseData>('/api/profile/titles', { body, getToken, method: 'PUT' });
      if (Array.isArray(response?.titles)) setData(response);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Não deu para salvar agora. Tente de novo.');
    } finally {
      setPreview(undefined);
      setBusy(false);
    }
  }

  if (failed) return null;
  if (data === null) {
    return <article aria-busy="true" className="profile-card title-showcase title-showcase--loading"><span className="eyebrow">Títulos</span></article>;
  }

  const owned = data.titles.filter((title) => title.locked === undefined);
  const almost = data.titles
    .filter((title) => title.locked !== undefined && title.locked.ratio > 0 && title.locked.ratio < 1)
    .slice(0, 3);
  const visible = data.titles.filter((title) => filter === 'todos' || title.group === filter);
  const pinned = data.pins
    .map((id) => owned.find((title) => title.id === id))
    .filter((title): title is ShowcaseTitle => title !== undefined);
  const shown = preview === undefined ? data.current : preview;

  function togglePin(title: ShowcaseTitle) {
    if (data === null) return;
    const isPinned = data.pins.includes(title.id);
    if (!isPinned && data.pins.length >= MAX_PINS) {
      setMessage('Já tem três em destaque. Tire um deles para colocar este.');
      return;
    }
    void save({ pins: isPinned ? data.pins.filter((id) => id !== title.id) : [...data.pins, title.id] });
  }

  if (data.possible === 0) {
    return (
      <article className="profile-card title-showcase title-showcase--empty">
        <span className="eyebrow">Títulos</span>
        <h2>Seu primeiro título sai na Rankeada</h2>
        <p>Vença uma Rankeada em qualquer tema e ele já aparece aqui, pronto para usar sob o seu nome.</p>
      </article>
    );
  }

  return (
    <section aria-labelledby="title-showcase-heading" className="title-showcase">
      <article className="profile-card title-preview">
        <span className="eyebrow">Como os outros te veem</span>
        <div className="title-preview__duel" key={shown?.label ?? 'none'}>
          <AvatarFrame frameId={viewer.frameId} variant="result">
            <Avatar customUrl={viewer.customAvatarUrl} googleUrl={viewer.photoUrl} name={viewer.displayName} size="large" />
          </AvatarFrame>
          <strong className="title-preview__name">{viewer.displayName}</strong>
          {shown === null
            ? <span className="title-preview__none">Sem título por enquanto</span>
            : <PlayerTitleText animated title={shown} />}
        </div>
        <div aria-label="Títulos em destaque" className="title-slots" role="group">
          {Array.from({ length: MAX_PINS }, (_, index) => {
            const title = pinned[index];
            if (title === undefined) {
              return (
                <span className="title-slot title-slot--empty" key={`empty-${index}`}>
                  <Icon name="star" />
                  <small>Destaque com a estrela</small>
                </span>
              );
            }
            return (
              <button
                aria-label={`Tirar ${title.label} dos destaques`}
                className={`title-slot title-slot--${title.style}`}
                disabled={busy}
                key={title.id}
                onClick={() => togglePin(title)}
                type="button"
              >
                <Glyph title={title} />
                <small>{title.label}</small>
              </button>
            );
          })}
        </div>
        <label className="title-auto">
          <span>
            <strong>Top automático</strong>
            <small>Quando você estiver no Top 10 do tema da partida, é ele que aparece.</small>
          </span>
          <input
            checked={data.autoTop}
            disabled={busy}
            onChange={() => void save({ autoTop: !data.autoTop })}
            role="switch"
            type="checkbox"
          />
          <i aria-hidden="true" className="title-auto__switch" />
        </label>
      </article>

      <article className="profile-card title-collection">
        <header className="title-collection__head">
          <div>
            <span className="eyebrow">Seus títulos</span>
            <h2 id="title-showcase-heading">{data.owned} de {data.possible}</h2>
          </div>
          <span
            aria-label={`${Math.round((data.owned / data.possible) * 100)}% conquistado`}
            className="title-ring"
            role="img"
            style={{ '--done': data.owned / data.possible } as CSSProperties}
          >
            <b aria-hidden="true">{Math.round((data.owned / data.possible) * 100)}%</b>
          </span>
        </header>

        {almost.length > 0 && (
          <div className="title-almost">
            <span className="title-almost__label">Quase lá</span>
            {almost.map((title) => (
              <div className="title-almost__row" key={title.id}>
                <PlayerTitleText compact title={title} />
                <span className="title-bar"><i style={{ transform: `scaleX(${title.locked?.ratio ?? 0})` }} /></span>
                <small>{title.locked?.text}</small>
              </div>
            ))}
          </div>
        )}

        <div aria-label="Filtrar títulos" className="title-filters" role="group">
          {FILTERS.map(([value, label]) => (
            <button aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} key={value} onClick={() => setFilter(value)} type="button">{label}</button>
          ))}
        </div>

        {message !== null && <p className="form-error" role="alert">{message}</p>}

        {visible.length === 0
          ? <p className="title-collection__empty">{filter === 'top' ? 'Nenhum Top seu por enquanto. Eles aparecem quando o tema tem gente suficiente no ranking.' : 'Nada aqui ainda.'}</p>
          : (
            <ul className="title-grid">
              {visible.map((title) => {
                const equipped = title.id === data.equippedId;
                const isPinned = data.pins.includes(title.id);
                if (title.locked !== undefined) {
                  return (
                    <li key={title.id}>
                      <div className="title-card title-card--locked">
                        <PlayerTitleText title={title} />
                        <small>{title.hint}</small>
                        <span className="title-bar"><i style={{ transform: `scaleX(${title.locked.ratio})` }} /></span>
                        <small className="title-card__progress">{title.locked.text}</small>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={title.id}>
                    <div className={`title-card${equipped ? ' title-card--equipped' : ''}`}>
                      <button
                        aria-pressed={equipped}
                        className="title-card__equip"
                        disabled={busy}
                        onClick={() => void save(
                          { equippedId: equipped ? null : title.id },
                          equipped ? null : { label: title.label, style: title.style },
                        )}
                        type="button"
                      >
                        {equipped && <span className="title-card__badge">✓ Em uso</span>}
                        <PlayerTitleText title={title} />
                        <small>{equipped ? 'Toque de novo para tirar' : title.hint}</small>
                      </button>
                      <button
                        aria-label={isPinned ? `Tirar ${title.label} dos destaques` : `Destacar ${title.label}`}
                        aria-pressed={isPinned}
                        className={`title-card__pin${isPinned ? ' is-pinned' : ''}`}
                        disabled={busy}
                        onClick={() => togglePin(title)}
                        type="button"
                      >
                        <Icon name="star" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </article>
    </section>
  );
}
