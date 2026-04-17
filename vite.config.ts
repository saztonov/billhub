import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
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
