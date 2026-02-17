import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Определяем endpoint для прокси в зависимости от провайдера
  const storageProvider = env.VITE_STORAGE_PROVIDER || 'cloudru'
  const s3Endpoint = storageProvider === 'cloudflare'
    ? env.VITE_R2_ENDPOINT
    : env.VITE_S3_ENDPOINT

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/s3-proxy': {
          target: s3Endpoint,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/s3-proxy/, ''),
        },
      },
    },
  }
})
