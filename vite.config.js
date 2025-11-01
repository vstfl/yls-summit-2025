import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: '/yls-summit-2025/',
  plugins: [svelte()],
  build: {
    outDir: 'docs',
  },
})
