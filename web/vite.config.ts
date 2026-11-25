import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { audioRefresherPlugin } from './vite-plugins/audio-refresher';

export default defineConfig({
  plugins: [react(), audioRefresherPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Tauri 需要相对路径
  base: './',
  server: {
    port: parseInt(process.env.WEB_PORT || '49201', 10),
    strictPort: true,
    open: false,
  },
  // Tauri 需要此配置
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    emptyOutDir: true,
    // Tauri 使用 Chromium WebView，支持最新特性
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          // Three.js 及其 React 绑定拆分为独立 chunk（~600KB）
          'three': ['three', '@react-three/fiber'],
          // React 核心拆分
          'vendor-react': ['react', 'react-dom'],
        }
      }
    }
  }
});
