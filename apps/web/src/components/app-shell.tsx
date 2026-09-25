import type { CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { levelProgress } from '@quiz-gomes/domain';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Icon, type IconName } from './icons.js';
import { Logo } from './logo.js';

const destinations: Array<{ icon: IconName; label: string; to: string }> = [
  { icon: 'themes', label: 'Temas', to: '/' },
  { icon: 'social', label: 'Social', to: '/social' },
  { icon: 'profile', label: 'Perfil', to: '/perfil' },
];

export function AppShell() {
  const { firebaseUser, loading, profile } = useAuth();
  // Enquanto o Firebase restaura a sessão, nada de anunciar "Visitante".
  const restoring = loading && profile === null && firebaseUser === null;
  const { onlineCount, pendingCount } = useSocial();
  const location = useLocation();
  const progress = profile === null ? null : levelProgress(
    typeof profile.totalXp === 'number' ? profile.totalXp : 0,
  );
  const level = progress?.level ?? null;
  const activeIndex = destinations.findIndex((destination) => (
    destination.to === '/'
      ? location.pathname === '/' || location.pathname.startsWith('/temas/')
      : location.pathname.startsWith(destination.to)
  ));
  const navStyle = { '--nav-index': Math.max(0, activeIndex) } as CSSProperties;
  const ringStyle = { '--xp-progress': progress?.progress ?? 0 } as CSSProperties;
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <Logo />
          {typeof onlineCount === 'number' && (
            <span aria-label={`${onlineCount} usuários online`} className="header-online" role="status">
              <span aria-hidden="true" className="header-online__dot" />
              <span>{onlineCount}</span>
              <span className="header-online__label">online</span>
            </span>
          )}
        </div>
        <NavLink className="header-profile" to="/perfil" aria-label="Abrir perfil">
          <span className="header-profile__copy">
            <small>{level === null ? (firebaseUser ? 'Complete seu perfil' : restoring ? 'Restaurando sessão' : 'Visitante') : `Nível ${level}`}</small>
            <strong>{profile?.displayName ?? firebaseUser?.displayName ?? (restoring ? '...' : 'Entrar')}</strong>
          </span>
          <span className={`xp-ring${progress === null ? ' xp-ring--empty' : ''}`} style={ringStyle}>
            <AvatarFrame frameId={profile?.equippedFrameId}>
              <Avatar
                customUrl={profile?.customAvatarUrl}
                googleUrl={profile?.photoUrl ?? firebaseUser?.photoURL}
                name={profile?.displayName ?? firebaseUser?.displayName ?? 'Visitante'}
                size="small"
              />
            </AvatarFrame>
            {level !== null && <span aria-hidden="true" className="xp-ring__level">{level}</span>}
          </span>
        </NavLink>
      </header>
      <main className="app-content" id="conteudo-principal" key={location.pathname}>
        <Outlet />
      </main>
      <nav className={`bottom-nav${activeIndex < 0 ? ' bottom-nav--none' : ''}`} aria-label="Navegação principal" style={navStyle}>
        <span aria-hidden="true" className="bottom-nav__indicator" />
        {destinations.map((destination, index) => (
          <NavLink
            className={({ isActive }) => `bottom-nav__item${isActive || index === activeIndex ? ' bottom-nav__item--active' : ''}`}
            end={destination.to === '/'}
            key={destination.to}
            to={destination.to}
          >
            <Icon name={destination.icon} />
            {destination.to === '/social' && pendingCount > 0 ? (
              <span aria-label={`${pendingCount} solicitações de amizade recebidas`} className="bottom-nav__badge">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            ) : null}
            <span>{destination.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
