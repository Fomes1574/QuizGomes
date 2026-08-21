import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { Avatar } from './avatar.js';
import { AvatarFrame } from './avatar-frame.js';
import { Icon, type IconName } from './icons.js';
import { Logo } from './logo.js';

const destinations: Array<{ icon: IconName; label: string; to: string }> = [
  { icon: 'themes', label: 'Temas', to: '/' },
  { icon: 'social', label: 'Social', to: '/social' },
  { icon: 'create', label: 'Criar', to: '/criar' },
  { icon: 'profile', label: 'Perfil', to: '/perfil' },
];

export function AppShell() {
  const { firebaseUser, profile } = useAuth();
  const { pendingCount } = useSocial();
  const location = useLocation();
  return (
    <div className="app-shell">
      <header className="app-header">
        <Logo />
        <NavLink className="header-profile" to="/perfil" aria-label="Abrir perfil">
          <span className="header-profile__copy">
            <small>{profile ? `Nível ${1}` : firebaseUser ? 'Complete seu perfil' : 'Visitante'}</small>
            <strong>{profile?.displayName ?? firebaseUser?.displayName ?? 'Entrar'}</strong>
          </span>
          <AvatarFrame frameId={profile?.equippedFrameId}>
            <Avatar
              customUrl={profile?.customAvatarUrl}
              googleUrl={profile?.photoUrl ?? firebaseUser?.photoURL}
              name={profile?.displayName ?? firebaseUser?.displayName ?? 'Visitante'}
              size="small"
            />
          </AvatarFrame>
        </NavLink>
      </header>
      <main className="app-content" id="conteudo-principal" key={location.pathname}>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegação principal">
        {destinations.map((destination) => (
          <NavLink
            className={({ isActive }) => `bottom-nav__item${isActive ? ' bottom-nav__item--active' : ''}`}
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
