import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// Chrome 的 Private Network Access (PNA) 會擋下公開 HTTPS 頁面（Bondage Club）
// 去 fetch localhost 的本地 bundle，除非本地伺服器用這個 header 明確允許。
// 沒有它，dynamic import() localhost:5174/assets/main.js 會直接失敗。
function privateNetworkAccessPlugin() {
  const addHeader = (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
  };
  return {
    name: 'private-network-access-header',
    configureServer(server) { server.middlewares.use(addHeader); },
    configurePreviewServer(server) { server.middlewares.use(addHeader); },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [privateNetworkAccessPlugin()],
  base: './',
  define: {
    __LCE_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { cors: true },
  preview: { cors: true },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    // 背景圖體積大，輸出成獨立的 hash 檔（可被瀏覽器快取），不要內嵌進 main.js —— 否則
    // loader 的 ?v=timestamp 會讓整包含圖每次登入都重抓。小圖示（SVG 等）仍用預設內嵌。
    assetsInlineLimit: (filePath) => {
      if (/\.(jpe?g|png|webp|gif|avif)$/i.test(filePath)) return false;
      return undefined;
    },
    rollupOptions: {
      input: 'src/main.js',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        // 圖片等 asset 加 content hash：內容變更時檔名跟著變，避免瀏覽器讀到舊快取。
        // main.js 不加 hash（loader 用固定 URL + ?v= 破快取），會自動引用到最新的 hash 檔名。
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
