import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['@excalidraw/excalidraw', 'react', 'react-dom/client'],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'element-plus': ['element-plus'],
          mermaid: ['mermaid'],
          chart: ['chart.js'],
          katex: ['katex'],
          // pdf.js 与其 worker 源码单独成块，配合 PDF 阅读器的异步加载按需拉取
          pdfjs: ['pdfjs-dist'],
          // 白板（Excalidraw + React 运行时）单独成块，仅在打开白板文件时按需加载
          whiteboard: ['@excalidraw/excalidraw', 'react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
