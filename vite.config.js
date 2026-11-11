import { defineConfig } from 'vite';

// base './' lets the build be hosted from any path (GitHub Pages, a towson.edu subfolder, etc.)
export default defineConfig({ base: './', build: { target: 'es2020' } });
