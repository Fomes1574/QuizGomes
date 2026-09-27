import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FRAME_CATALOG, presentAchievement, type AchievementItem, type FrameItem } from '../lib/achievements.js';
import type { MatchSummary } from '../lib/models.js';
import { Icon } from './icons.js';

export interface MissionSummary {
  completedAt: string | null;
  progress: number;
  target: number;
  type: 'ANSWER_QUESTIONS' | 'CORRECT_ANSWERS' | 'PLAY_MATCH';
}

export interface StreakSummary {
  atRisk?: boolean;
  bestStreak: number;
  currentStreak: number;
  themeName: string;
  themeSlug?: string;
}

export interface RecentMatch {
  finishedAt: string;
  matchId: string;
  mode: 'CASUAL' | 'RANKED';
  myScore: number;
  opponent: { displayName: string; publicId: string } | null;
  opponentScore: number;
  result: 'DRAW' | 'LOSS' | 'WIN';
  themeName: string;
  themeSlug: string;
  xpDelta: number;
}

export interface ThemeRecord {
  bestScore: number;
  mode: 'CASUAL' | 'RANKED';
  themeName: string;
  themeSlug: string;
}

const MISSION_LABELS: Record<MissionSummary['type'], string> = {
  ANSWER_QUESTIONS: 'Responda perguntas',
  CORRECT_ANSWERS: 'Acerte perguntas',
  PLAY_MATCH: 'Jogue uma partida válida',
};

/** "3 h 12 min", "45 min", "menos de 1 min". */
export function resetCountdown(resetAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.ceil((resetAtMs - nowMs) / 60_000));
  if (minutes <= 0) return 'menos de 1 min';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "hoje", "ontem", "há 3 dias" ou a data curta. */
export function relativeDay(iso: string, nowMs: number): string {
  const time = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(time)) return '';
  const day = (ms: number) => Math.floor((ms - 3 * 3_600_000) / 86_400_000);
  const delta = day(nowMs) - day(time);
  if (delta <= 0) return 'hoje';
  if (delta === 1) return 'ontem';
  if (delta < 7) return `há ${delta} dias`;
  return new Date(time).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function MissionsCard({ missions, resetAt }: { missions: MissionSummary[]; resetAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Contagem por minuto: barata e suficiente para "renovam em 3 h 12 min".
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const resetMs = resetAt === null ? Number.NaN : Date.parse(resetAt);
  const done = missions.filter((mission) => mission.completedAt !== null).length;
  return (
    <article className="profile-card profile-card--missions">
      <div className="profile-card__head">
        <span className="eyebrow">Missões de hoje</span>
        {Number.isFinite(resetMs) && <small className="profile-card__meta">Renovam em {resetCountdown(resetMs, now)}</small>}
      </div>
      <ul className="missions-list">
        {missions.map((mission) => (
          <li className="missions-list__item" data-done={mission.completedAt !== null} key={mission.type}>
            <div className="missions-list__row"><span><i aria-hidden="true" className="missions-list__check">{mission.completedAt !== null ? '✓' : ''}</i>{MISSION_LABELS[mission.type]}</span><span>{Math.min(mission.progress, mission.target)}/{mission.target}</span></div>
            <div className="progress-track"><span style={{ transform: `scaleX(${mission.target === 0 ? 0 : Math.min(1, mission.progress / mission.target)})` }} /></div>
          </li>
        ))}
        {missions.length === 0 && <li>Sem missões disponíveis hoje.</li>}
      </ul>
      {missions.length > 0 && (
        <p className="profile-card__hint">{done === missions.length ? 'Dia completo! Volte amanhã para novas missões.' : 'Complete as três num dia para ganhar a moldura Dever cumprido.'}</p>
      )}
    </article>
  );
}

export function StreakCard({ streak }: { streak: StreakSummary | null }) {
  if (streak === null) {
    return (
      <article className="profile-card profile-card--streak">
        <span className="eyebrow">Ofensiva</span>
        <p>Jogue uma partida em qualquer tema para acender sua ofensiva.</p>
      </article>
    );
  }
  const alive = streak.currentStreak > 0;
  return (
    <article className={`profile-card profile-card--streak${alive ? ' profile-card--streak-alive' : ''}${streak.atRisk === true ? ' profile-card--streak-risk' : ''}`}>
      <span className="eyebrow">Ofensiva</span>
      <h2 className="streak-title"><Icon name="flame" />{streak.currentStreak} {streak.currentStreak === 1 ? 'dia' : 'dias'}</h2>
      <p>
        {alive ? streak.themeName : 'Sua ofensiva apagou.'} · recorde de {streak.bestStreak} {streak.bestStreak === 1 ? 'dia' : 'dias'}
      </p>
      {streak.atRisk === true && (
        <p className="profile-card__warning" role="status">
          Ainda não jogou hoje: uma partida {streak.themeSlug === undefined ? 'neste tema' : <Link to={`/temas/${streak.themeSlug}`}>em {streak.themeName}</Link>} mantém a chama acesa.
        </p>
      )}
    </article>
  );
}

function winRate(summary: MatchSummary): string {
  if (summary.matches === 0) return '—';
  return `${Math.round((summary.wins / summary.matches) * 100)}%`;
}

export function ModeStatsCard({ casual, ranked }: { casual: MatchSummary | null; ranked: MatchSummary | null }) {
  const [mode, setMode] = useState<'CASUAL' | 'RANKED'>('RANKED');
  const summary = mode === 'RANKED' ? ranked : casual;
  const label = mode === 'RANKED' ? 'Rankeada' : 'Normal';
  return (
    <article className="profile-card profile-card--stats">
      <div className="profile-card__head">
        <span className="eyebrow">Suas partidas</span>
        <div aria-label="Modo das estatísticas" className="segmented segmented--small" role="radiogroup">
          {(['RANKED', 'CASUAL'] as const).map((value) => (
            <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => setMode(value)} role="radio" type="button">
              {value === 'RANKED' ? 'Rankeada' : 'Normal'}
            </button>
          ))}
        </div>
      </div>
      {summary === null || summary.matches === 0 ? (
        <p>{mode === 'RANKED' ? 'Sua primeira Rankeada aparece aqui.' : 'Sua primeira partida Normal aparece aqui.'}</p>
      ) : (
        <>
          <ul aria-label={`Partidas ${label}`} className="match-summary">
            <li><strong>{summary.matches}</strong><span>Partidas</span></li>
            <li><strong>{summary.wins}</strong><span>Vitórias</span></li>
            <li><strong>{summary.losses}</strong><span>Derrotas</span></li>
            <li><strong>{summary.draws}</strong><span>Empates</span></li>
          </ul>
          <p className="profile-card__hint">Aproveitamento na {label}: <strong>{winRate(summary)}</strong></p>
        </>
      )}
    </article>
  );
}

const RESULT_MARK: Record<RecentMatch['result'], { label: string; mark: string }> = {
  DRAW: { label: 'Empate', mark: '=' },
  LOSS: { label: 'Derrota', mark: '×' },
  WIN: { label: 'Vitória', mark: '✓' },
};

export function RecentMatchesCard({ matches }: { matches: RecentMatch[] }) {
  // "hoje"/"ontem" congelados na montagem: o cartão não precisa de relógio vivo.
  const [now] = useState(() => Date.now());
  return (
    <article className="profile-card profile-card--recent">
      <span className="eyebrow">Últimas partidas</span>
      {matches.length === 0 ? <p>Suas partidas aparecem aqui assim que terminarem.</p> : (
        <ol className="recent-matches">
          {matches.map((match) => {
            const result = RESULT_MARK[match.result];
            return (
              <li className={`recent-match recent-match--${match.result.toLowerCase()}`} key={match.matchId}>
                <span aria-label={result.label} className="recent-match__mark" role="img">{result.mark}</span>
                <div className="recent-match__body">
                  <Link className="recent-match__theme" to={`/temas/${match.themeSlug}`}>{match.themeName}</Link>
                  <small>
                    {match.mode === 'RANKED' ? 'Rankeada' : 'Normal'}
                    {match.opponent !== null ? ` · contra ${match.opponent.displayName}` : ''}
                    {' · '}{relativeDay(match.finishedAt, now)}
                  </small>
                </div>
                <strong className="recent-match__score">{match.myScore}<span aria-hidden="true">×</span><span className="sr-only"> a </span>{match.opponentScore}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

export function ThemeRecordsCard({ records }: { records: ThemeRecord[] }) {
  const byTheme = new Map<string, { CASUAL?: number; RANKED?: number; name: string }>();
  for (const record of records) {
    const entry = byTheme.get(record.themeSlug) ?? { name: record.themeName };
    entry[record.mode] = record.bestScore;
    byTheme.set(record.themeSlug, entry);
  }
  return (
    <article className="profile-card profile-card--records">
      <span className="eyebrow">Recordes por tema</span>
      {byTheme.size === 0 ? <p>Termine uma partida para marcar seu primeiro recorde.</p> : (
        <ul className="theme-records">
          {[...byTheme.entries()].map(([slug, entry]) => (
            <li key={slug}>
              <Link to={`/temas/${slug}`}>{entry.name}</Link>
              <span className="theme-records__values">
                <span title="Recorde na Normal"><small>Normal</small><strong>{entry.CASUAL ?? '—'}</strong></span>
                <span title="Recorde na Rankeada"><small>Rankeada</small><strong>{entry.RANKED ?? '—'}</strong></span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function AchievementsCard({
  achievements,
  busyFrame,
  frames,
  onEquip,
}: {
  achievements: AchievementItem[];
  busyFrame: string | null;
  frames: FrameItem[];
  onEquip: (frameId: string | null) => void;
}) {
  const owned = new Map(frames.map((frame) => [frame.id, frame]));
  const equipped = frames.find((frame) => frame.equipped)?.id ?? null;
  return (
    <article className="profile-card profile-card--achievements">
      <span className="eyebrow">Molduras</span>
      <ul className="frame-picker">
        {FRAME_CATALOG.map((frame) => {
          const mine = owned.get(frame.id);
          const isEquipped = equipped === frame.id;
          return (
            <li key={frame.id}>
              <button
                aria-pressed={isEquipped}
                className={`frame-picker__item${mine === undefined ? ' frame-picker__item--locked' : ''}`}
                disabled={mine === undefined || busyFrame !== null}
                onClick={() => onEquip(isEquipped ? null : frame.id)}
                type="button"
              >
                <span aria-hidden="true" className="frame-picker__preview avatar-frame avatar-frame--equipped" data-frame-id={frame.id}><i /></span>
                <strong>{frame.name}</strong>
                <small>{mine === undefined ? frame.hint : isEquipped ? 'Em uso · toque para tirar' : 'Toque para usar'}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <span className="eyebrow profile-card__subhead">Conquistas</span>
      {achievements.length === 0 ? <p>Jogue 7 dias seguidos para a primeira conquista.</p> : (
        <ul className="achievement-list">
          {achievements.map((achievement) => {
            const view = presentAchievement(achievement);
            return (
              <li className={`achievement-chip achievement-chip--${view.tier}`} key={achievement.achievementId}>
                <span aria-hidden="true" className="achievement-chip__big">{view.big}</span>
                <span><strong>{view.title}</strong><small>{view.description}</small></span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
