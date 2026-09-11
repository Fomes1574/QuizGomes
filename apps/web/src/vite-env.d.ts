/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __QG_BUILD_FINGERPRINT__: string;

interface ImportMetaEnv {
  readonly VITE_FIREBASE_VAPID_PUBLIC_KEY?: string;
}
