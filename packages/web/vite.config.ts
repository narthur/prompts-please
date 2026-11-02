import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: '../../assets/derived',
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.PROMPTS_PLEASE_PORT ?? 4317}` } },
})
