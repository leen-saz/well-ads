// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import versionAssets from './src/integrations/version-assets.mjs';

export default defineConfig({
  output: 'server',
  // No Astro sessions (auth is our own signed cookie) and no image service: no KV or Images binding needed.
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  // React islands for the shadcn/ui pieces (src/components/ui), Tailwind for their styles (src/styles/ui.css, loaded only by those pages)
  // versionAssets: /assets and /modules scripts and styles also served from /r/<hash>/, immutable (src/lib/asset-paths.mjs)
  integrations: [react(), versionAssets()],
  vite: { plugins: [tailwindcss()] },
  // Links prepare the next page on hover; with the ClientRouter tabs switch without a full reload
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  security: {
    checkOrigin: true,
    // Strict CSP: Astro hashes its own scripts and styles; nothing inline without a hash.
    csp: {
      directives: [
        "default-src 'self'",
        // blob: only for files the page itself just made (generated voice, uploaded picture preview); never a remote origin
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ],
      // Style attributes are used across the UI. All fonts are served from /assets/fonts (no Google Fonts).
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
    },
  },
});
