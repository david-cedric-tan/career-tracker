import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * HTTPS, when `run.sh --https` has generated a certificate and pointed these
 * at it.
 *
 * Installing the app and registering a service worker both require a secure
 * origin, and `http://192.168.x.x` is not one — over plain HTTP on the LAN the
 * install option simply never appears, however complete the manifest is.
 */
const certFile = process.env.VITE_HTTPS_CERT
const keyFile = process.env.VITE_HTTPS_KEY
const https =
  certFile && keyFile
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : undefined

/**
 * In HTTPS mode the API is proxied through this server instead of being called
 * on `:8000` directly. That keeps everything same-origin, which means Django
 * needs no certificate of its own (it has no good way to serve one) and the
 * browser is never asked to make a plain-HTTP request from a secure page,
 * which it would block as mixed content.
 */
const proxyTarget = process.env.VITE_PROXY_TARGET

/**
 * Vite checks the request's Host header against its own allowlist,
 * separately from Django's `ALLOWED_HOSTS` — without this, a tunnel (see
 * `run.sh --tunnel`) gets its request rejected by Vite itself before Django
 * ever sees it. Only the suffix is known ahead of time (a quick tunnel's
 * hostname is random per run); a leading `.` allows that suffix and every
 * hostname ending in it, the same convention `ALLOWED_HOSTS` uses.
 */
const allowedHostSuffix = process.env.VITE_ALLOWED_HOST_SUFFIX

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
    ...(https ? { https } : {}),
    ...(allowedHostSuffix ? { allowedHosts: [allowedHostSuffix] } : {}),
    ...(proxyTarget
      ? {
          // `xfwd` adds X-Forwarded-Proto/Host so Django knows the page is
          // HTTPS and builds https:// media URLs — without it every photo and
          // logo came back as http://, which browsers block as mixed content.
          proxy: {
            '/api': { target: proxyTarget, changeOrigin: false, xfwd: true },
            '/media': { target: proxyTarget, changeOrigin: false, xfwd: true },
            '/static': { target: proxyTarget, changeOrigin: false, xfwd: true },
          },
        }
      : {}),
  },
})
