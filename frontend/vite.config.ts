import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Chrome's install prompt needs a registered service worker even in
      // dev — off by default in vite-plugin-pwa to avoid dev-server caching
      // surprises, but this app has none of those (no runtime caching of
      // `/api/*`, see below), so there's nothing it'd get in the way of.
      devOptions: { enabled: true },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Career Tracker',
        short_name: 'Career Tracker',
        description: 'Track job applications, contacts, resumes and follow-ups in one place.',
        theme_color: '#7e14ff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // A live-data app, not an offline one — only the static app shell
        // (JS/CSS/fonts/icons) is precached. No runtime caching route is
        // added for `/api/*`, so every request there always hits the network
        // — the tracker should never show stale application data because a
        // service worker served it a cached response.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
  },
})
