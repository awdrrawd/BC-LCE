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
  // JS chunk 維持相對路徑：localhost/main.js 載 localhost/app.js，
  // jsDelivr/main.js 載 jsDelivr/app.js。只有大型圖片／影片改由 Pages 提供。
  experimental: {
    renderBuiltUrl(filename, { type }) {
      if (type === 'asset') return `https://awdrrawd.github.io/BC-LCE/${filename}`;
      return { relative: true };
    },
  },
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
      // 背景圖與背景影片都體積大，一律輸出成獨立 hash 檔，不要內嵌進 main.js。
      if (/\.(jpe?g|png|webp|gif|avif|mp4|webm)$/i.test(filePath)) return false;
      return undefined;
    },
    rollupOptions: {
      input: 'src/main.js',
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        // 圖片等 asset 加 content hash：內容變更時檔名跟著變，避免瀏覽器讀到舊快取。
        // main.js 不加 hash（loader 用固定 URL + ?v= 破快取），會自動引用到最新的 hash 檔名。
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
