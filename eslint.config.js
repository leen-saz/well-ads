import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default defineConfig(
  // public/assets: legacy scripts copied as-is from the live site; refactored in phase 4.
  { ignores: ['public/assets/', 'dist/', '.astro/', '.wrangler/', 'node_modules/', 'worker-configuration.d.ts'] },
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
);
