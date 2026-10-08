import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppShell } from './components/app-shell.js';
import { LoadingState } from './components/async-state.js';
import { DirectChallengeWaiting } from './components/direct-challenge-waiting.js';
import { OnboardingDialog } from './components/onboarding-dialog.js';
import { ChallengeProvider } from './features/challenge-context.js';
import { NotFoundPage } from './pages/not-found-page.js';
import { ProfilePage } from './pages/profile-page.js';
import { ThemeDetailPage } from './pages/theme-detail-page.js';
import { ThemesPage } from './pages/themes-page.js';

const CreatePage = lazy(() => import('./pages/create-page.js').then((module) => ({ default: module.CreatePage })));
const LiveMatchPage = lazy(() => import('./pages/live-match-page.js').then((module) => ({ default: module.LiveMatchPage })));
const InvitePage = lazy(() => import('./pages/invite-page.js').then((module) => ({ default: module.InvitePage })));
const SocialPage = lazy(() => import('./pages/social-page.js').then((module) => ({ default: module.SocialPage })));
const ThemeRankingPage = lazy(() => import('./pages/theme-ranking-page.js').then((module) => ({ default: module.ThemeRankingPage })));
const PlayerPage = lazy(() => import('./pages/player-page.js').then((module) => ({ default: module.PlayerPage })));

/** Trocar de tema (ex.: "ir para a fila vizinha") remonta a página do zero. */
function ThemeDetailRoute() {
  const { slug = '' } = useParams();
  // Um convite de revanche aceito já dentro do mesmo tema também remonta a
  // página: a busca privada começa do zero, como veio do resultado.
  const rematch = (useLocation().state as { rematch?: unknown } | null)?.rematch;
  return <ThemeDetailPage key={typeof rematch === 'string' ? `${slug}:${rematch}` : slug} />;
}

export function App() {
  return (
    <ChallengeProvider>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ThemesPage />} />
          <Route path="social" element={<Suspense fallback={<LoadingState label="Abrindo Social" />}><SocialPage /></Suspense>} />
          <Route path="admin" element={<Suspense fallback={<LoadingState label="Abrindo administração" />}><CreatePage adminOnly /></Suspense>} />
          <Route path="criar" element={<Navigate replace to="/" />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="temas/:slug" element={<ThemeDetailRoute />} />
          <Route path="temas/:slug/ranking" element={<Suspense fallback={<LoadingState label="Abrindo o ranking" />}><ThemeRankingPage /></Suspense>} />
          <Route path="jogador/:code" element={<Suspense fallback={<LoadingState label="Abrindo perfil" />}><PlayerPage /></Suspense>} />
          <Route path="convite/:code" element={<Suspense fallback={<LoadingState label="Abrindo convite" />}><InvitePage /></Suspense>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="partida/:roomId" element={<Suspense fallback={<main className="match-lobby-screen"><LoadingState label="Preparando partida" /></main>}><LiveMatchPage /></Suspense>} />
        <Route path="desafio/:challengeId" element={<Suspense fallback={<main className="match-lobby-screen"><LoadingState label="Preparando desafio" /></main>}><LiveMatchPage variant="challenge" /></Suspense>} />
      </Routes>
      <OnboardingDialog />
      {/* A espera do convite direto vive acima das rotas: nenhuma página precisa estar montada. */}
      <DirectChallengeWaiting />
    </ChallengeProvider>
  );
}
