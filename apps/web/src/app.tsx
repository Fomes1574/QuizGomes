import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell.js';
import { LoadingState } from './components/async-state.js';
import { OnboardingDialog } from './components/onboarding-dialog.js';
import { LiveMatchPage } from './pages/live-match-page.js';
import { NotFoundPage } from './pages/not-found-page.js';
import { ProfilePage } from './pages/profile-page.js';
import { SocialPage } from './pages/social-page.js';
import { ThemeDetailPage } from './pages/theme-detail-page.js';
import { ThemesPage } from './pages/themes-page.js';

const CreatePage = lazy(() => import('./pages/create-page.js').then((module) => ({ default: module.CreatePage })));

export function App() {
  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ThemesPage />} />
          <Route path="social" element={<SocialPage />} />
          <Route path="criar" element={<Suspense fallback={<LoadingState label="Abrindo criação" />}><CreatePage /></Suspense>} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="temas/:slug" element={<ThemeDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="partida/:roomId" element={<LiveMatchPage />} />
      </Routes>
      <OnboardingDialog />
    </>
  );
}
