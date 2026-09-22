import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + HashRouter: the built dist/ works from any static host, no server rewrites.
export default defineConfig({
  base: './',
  plugins: [react()],
});
