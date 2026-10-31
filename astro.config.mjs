// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // No Astro sessions (auth is our own signed cookie) and no image service: no KV or Images binding needed.
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  security: {
    checkOrigin: true,
    // Strict CSP: Astro hashes its own scripts and styles; nothing inline without a hash.
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ],
    },
  },
});
