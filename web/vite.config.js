import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // For `npm run dev`: forward API calls to your running gateway
    proxy: {
      '/api': { target: 'https://localhost:8443', secure: false, changeOrigin: true }
    }
  }
});