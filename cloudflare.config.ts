import { defineConfig } from 'cf/config';

// Static, client-side only site. No Worker code runs: Cloudflare serves the
// Vite build as assets. All Stellar work happens in the visitor's browser.
export default defineConfig({
  worker: {
    name: 'muxed-c',
    compatibilityDate: '2026-11-01',
    // Custom domain on the stellar.buzz zone (same account). Cloudflare creates
    // the DNS record and certificate on deploy.
    domains: ['muxed-c.stellar.buzz'],
    // Keep workers.dev on as well. The canonical tag points to the custom domain.
    workersDev: true,
    assets: {
      notFoundHandling: 'single-page-application',
    },
  },
});
