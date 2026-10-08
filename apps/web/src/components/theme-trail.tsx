import type { ThemeTrailStep } from '../lib/models.js';
import { Icon } from './icons.js';
import { PlayerTitleText } from './player-title.js';

/** "Ouro em Lost" → "Ouro"; "Veterano de Lost" → "Veterano": o tema já está no título da seção. */
function shortLabel(label: string, themeName: string): string {
  for (const joiner of [' em ', ' de ']) {
    const suffix = `${joiner}${themeName}`;
    if (label.endsWith(suffix)) return label.slice(0, -suffix.length);
  }
  return label;
}

/**
 * Trilha de títulos do tema: o que já saiu, o próximo em destaque com
 * quanto falta e o resto do caminho. O objetivo escolhido no Perfil ganha
 * uma estrela.
 */
export function ThemeTrail({ goalId, steps, themeName }: { goalId: string | null; steps: ThemeTrailStep[]; themeName: string }) {
  if (steps.length === 0) return null;
  const done = steps.filter((step) => step.unlocked).length;
  const next = steps.find((step) => !step.unlocked) ?? null;
  return (
    <section aria-labelledby="theme-trail-title" className="theme-trail">
      <header className="theme-trail__head">
        <div>
          <span className="eyebrow">Sua trilha</span>
          <h2 id="theme-trail-title">Títulos de {themeName}</h2>
        </div>
        <span className="theme-trail__count">{done} de {steps.length}</span>
      </header>
      {next === null
        ? <p className="theme-trail__next theme-trail__next--done">Você tem todos os títulos deste tema. Poucos chegam aqui.</p>
        : (
          <div className="theme-trail__next">
            <small>{next.id === goalId ? 'Seu objetivo é o próximo' : 'Próximo título'}</small>
            <PlayerTitleText title={next} />
            <span className="title-bar"><i style={{ transform: `scaleX(${next.progress?.ratio ?? 0})` }} /></span>
            <small>{next.progress?.text}</small>
          </div>
        )}
      <ol className="theme-trail__path">
        {steps.map((step) => (
          <li
            className={`theme-trail__step${step.unlocked ? ' is-done' : ''}${step === next ? ' is-next' : ''}`}
            key={step.id}
          >
            <span aria-hidden="true" className="theme-trail__dot">{step.unlocked ? '✓' : step.id === goalId ? <Icon name="star" /> : ''}</span>
            <span className="theme-trail__label">{shortLabel(step.label, themeName)}</span>
            <span className="sr-only">{step.unlocked ? 'conquistado' : step.progress?.text ?? 'ainda não'}{step.id === goalId ? ', seu objetivo' : ''}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
