import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell.js';
import { LoadingState } from './components/async-state.js';
import { OnboardingDialog } from './components/onboarding-dialog.js';
import { NotFoundPage } from './pages/not-found-page.js';
import { ProfilePage } from './pages/profile-page.js';
import { ThemeDetailPage } from './pages/theme-detail-page.js';
import { ThemesPage } from './pages/themes-page.js';

const CreatePage = lazy(() => import('./pages/create-page.js').then((module) => ({ default: module.CreatePage })));
const LiveMatchPage = lazy(() => import('./pages/live-match-page.js').then((module) => ({ default: module.LiveMatchPage })));
const SocialPage = lazy(() => import('./pages/social-page.js').then((module) => ({ default: module.SocialPage })));

export function App() {
  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ThemesPage />} />
          <Route path="social" element={<Suspense fallback={<LoadingState label="Abrindo Social" />}><SocialPage /></Suspense>} />
          <Route path="criar" element={<Suspense fallback={<LoadingState label="Abrindo criação" />}><CreatePage /></Suspense>} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="temas/:slug" element={<ThemeDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="partida/:roomId" element={<Suspense fallback={<main className="match-lobby-screen"><LoadingState label="Preparando partida" /></main>}><LiveMatchPage /></Suspense>} />
      </Routes>
      <OnboardingDialog />
    </>
  );
}
