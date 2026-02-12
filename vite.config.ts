import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
          target: env.VITE_S3_ENDPOINT,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/s3-proxy/, ''),
        },
      },
    },
  }
})
