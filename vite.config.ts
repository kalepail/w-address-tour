import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare()],
  // The Stellar SDK is most of the bundle (about 134 KB gzipped). That is fine
  // for a one-page tour, so raise the warning limit instead of splitting.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 700 },
});
