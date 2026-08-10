import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      devOptions: { enabled: false },
      includeAssets: ['brand/logo-placeholder.svg', 'icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: {
        background_color: '#FFF9F7',
        description: 'Quiz competitivo rápido, bonito e pessoal.',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
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
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            handler: 'NetworkOnly',
            method: 'GET',
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
});
