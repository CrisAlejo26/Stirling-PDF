import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tsconfigPaths({
        projects: ['./tsconfig.core.vite.json'],
      }),
      viteStaticCopy({
        targets: [
          {
            //provides static pdfium so embedpdf can run without cdn
            src: 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
            dest: 'pdfium'
          },
          {
            // Copy jscanify vendor files to dist
            src: 'public/vendor/jscanify/*',
            dest: 'vendor/jscanify'
          }
        ]
      })
    ],
    server: {
      host: true,
      // make sure this port matches the devUrl port in tauri.conf.json file
      port: 5173,
      // Tauri expects a fixed port, fail if that port is not available
      strictPort: true,
      watch: {
        // tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
      },
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/oauth2': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/saml2': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/login/oauth2': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/login/saml2': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/swagger-ui': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        '/v1/api-docs': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
      },
    },
    base: env.RUN_SUBPATH ? `/${env.RUN_SUBPATH}` : './',
  };
});
