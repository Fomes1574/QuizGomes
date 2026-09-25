import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app.js';
import { AppUpdateController } from './features/app-update-controller.js';
import { AuthProvider } from './features/auth-context.js';
import { SocialProvider } from './features/social-context.js';
import { ThemeModeProvider } from './hooks/use-theme-mode.js';
import { buildFingerprint, safeAppUpdate } from './lib/app-update.js';
import { captureInstallPrompt } from './lib/install-prompt.js';
import './styles/global.css';

const hadServiceWorkerController = navigator.serviceWorker?.controller !== null;
const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Ativa o novo worker agora; a página só recarrega fora da rota competitiva.
    void updateServiceWorker(true);
  },
});

if ('serviceWorker' in navigator) {
  let controllerSeen = hadServiceWorkerController;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controllerSeen) {
      controllerSeen = true;
      return;
    }
    safeAppUpdate.markReady();
    safeAppUpdate.onRoute(window.location.pathname, () => window.location.reload());
  });
}
document.documentElement.dataset.qgBuild = buildFingerprint;

const root = document.getElementById('root');
if (root === null) throw new Error('Elemento raiz não encontrado.');

captureInstallPrompt();
createRoot(root).render(
  <StrictMode>
    <ThemeModeProvider>
      <AuthProvider>
        <SocialProvider>
          <BrowserRouter>
            <AppUpdateController />
            <App />
          </BrowserRouter>
        </SocialProvider>
      </AuthProvider>
    </ThemeModeProvider>
  </StrictMode>,
);
