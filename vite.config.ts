import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Единый идентификатор на сборку: вшивается в бандл (__BUILD_ID__) и кладётся
// в dist/version.json. В рантайме хук useVersionCheck сравнивает их и предлагает
// обновиться, если вкладка работает на устаревшем бандле.
// Меняется при каждой реальной пересборке фронта (на деплое git pull меняет
// исходники → Docker пересобирает слой сборки). Можно переопределить env BUILD_ID.
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString()

// Плагин эмитит статический version.json в корень dist/ с текущим buildId
const versionFilePlugin = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildId: BUILD_ID }),
    })
  },
})

export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    // Вшивание идентификатора сборки прямо в JS-бандл (статическая подстановка)
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Проксирование API-запросов на бэкенд в dev-режиме
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Крупный редко меняющийся React-блок — отдельный долгоживущий чанк
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Ant Design + иконки всегда используются вместе — один чанк, меньше параллельных HTTP-запросов
          'vendor-antd': ['antd', '@ant-design/icons'],
          // zustand крошечный (~660 байт) — пусть лежит в общем бандле приложения, отдельный чанк не оправдан
        },
      },
    },
  },
})
