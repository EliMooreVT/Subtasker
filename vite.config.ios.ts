import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import type { Plugin } from 'vite';

// Vite always emits type="module" crossorigin in HTML regardless of rollup format.
// WKWebView rejects those as CORS failures when loading from file:// URLs.
// This plugin strips both attributes from the final HTML.
function stripModuleAttributes(): Plugin {
  return {
    name: 'strip-module-attributes',
    transformIndexHtml(html: string) {
      return html
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(/<link rel="modulepreload"[^>]*>/g, '');
    },
  };
}

// iOS build: outputs IIFE (no type="module", no crossorigin) so WKWebView
// can load assets via file:// without triggering CORS access-control checks.
export default defineConfig({
  plugins: [react(), stripModuleAttributes()],
  root: 'packages/ui/src',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: undefined,
        inlineDynamicImports: true,
      },
    },
    modulePreload: false,
  },
  server: {
    port: 5173,
  },
});
