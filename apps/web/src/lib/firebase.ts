import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';

export const firebaseApp = initializeApp(firebaseConfig);

/**
 * Persistência declarada explicitamente, da mais robusta para a mais simples.
 *
 * IndexedDB sobrevive melhor a recarga dura e ao modo standalone do PWA em
 * navegadores móveis; `browserLocalPersistence` é o fallback quando IndexedDB está
 * indisponível. Sem essa declaração a sessão parecia cair a cada reload no celular.
 */
function createAuth(): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Já inicializado (HMR) ou ambiente sem suporte: cai no padrão do SDK.
    return getAuth(firebaseApp);
  }
}

export const firebaseAuth = createAuth();

// Sem `prompt: select_account`: forçar o seletor em todo login normal só tornava a
// entrada mais lenta. Trocar de conta continua possível saindo e entrando de novo.
export const googleProvider = new GoogleAuthProvider();
