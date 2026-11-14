import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = process.env.BACKEND_URL || env.BACKEND_URL || 'https://backend.lightlink.club';
  const proxy = { '/api': { target, changeOrigin: true, timeout: 300000, proxyTimeout: 300000, rewrite: (path: string) => path.replace(/^\/api/, '') } };
  return {
    build: { outDir: 'dist-demo' },
    server: { proxy },
    preview: { proxy },
  };
});
