import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app.js';
import { AuthProvider } from './features/auth-context.js';
import { SocialProvider } from './features/social-context.js';
import { ThemeModeProvider } from './hooks/use-theme-mode.js';
import './styles/global.css';

registerSW({ immediate: true });

const root = document.getElementById('root');
if (root === null) throw new Error('Elemento raiz não encontrado.');

createRoot(root).render(
  <StrictMode>
    <ThemeModeProvider>
      <AuthProvider>
        <SocialProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SocialProvider>
      </AuthProvider>
    </ThemeModeProvider>
  </StrictMode>,
);
