import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue({ features: { prodDevtools: true } })],
  server: {
    proxy: {
      '/api': process.env.FORUM_API_URL || 'http://127.0.0.1:4000',
      '/uploads': process.env.FORUM_API_URL || 'http://127.0.0.1:4000',
    },
  },
})
