import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const buildFingerprint = (
  process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.VITE_GIT_SHA ?? 'local'
).slice(0, 12);

export default defineConfig({
  build: { emptyOutDir: true },
  define: { __QG_BUILD_FINGERPRINT__: JSON.stringify(buildFingerprint) },
  plugins: [
    react(),
    VitePWA({
      devOptions: { enabled: false },
      filename: 'sw.ts',
      includeManifestIcons: false,
      injectManifest: {
        globIgnores: [
          '**/avatar-editor-*.js',
          '**/create-page-*.js',
          '**/icons/**',
          '**/social-page-*.js',
          '**/theme-artwork-editor-*.js',
          'apple-touch-icon.png',
          'favicon-*.png',
          'favicon.ico',
        ],
      },
      manifest: {
        background_color: '#FFF9F7',
        description: 'Quiz competitivo rápido, bonito e pessoal.',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.webp', sizes: '192x192', type: 'image/webp', purpose: 'any' },
          { src: '/icons/icon-512.webp', sizes: '512x512', type: 'image/webp', purpose: 'any' },
          { src: '/icons/icon-512-maskable.webp', sizes: '512x512', type: 'image/webp', purpose: 'maskable' },
        ],
        lang: 'pt-BR',
        name: 'QUIZ GOMES',
        orientation: 'any',
        scope: '/',
        short_name: 'Quiz Gomes',
        start_url: '/',
        theme_color: '#D92F36',
      },
      registerType: 'autoUpdate',
      srcDir: 'src',
      strategies: 'injectManifest',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
});
