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

// 正式版 loader 放在專案根目錄（唯一來源），建置時原樣輸出到 dist/loader.user.js，
// 讓 https://awdrrawd.github.io/BC-LCE/loader.user.js 繼續可用。
// loader.local.user.js 只給本機開發，不部署。
function emitLoaderPlugin() {
  return {
    name: 'emit-loader',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'loader.user.js',
        source: readFileSync(new URL('./loader.user.js', import.meta.url)),
      });
    },
  };
}

// 互動式架構圖放在 docs/（GitHub 上只會顯示原始碼，無法直接開啟），建置時原樣輸出到
// dist/lce-architecture.html，經 Pages 提供：https://awdrrawd.github.io/BC-LCE/lce-architecture.html
// 頁面是自給自足的單一檔案（不引用其他資源），所以不需要處理相對路徑。
function emitArchitecturePagePlugin() {
  return {
    name: 'emit-architecture-page',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'lce-architecture.html',
        source: readFileSync(new URL('./docs/lce-architecture.html', import.meta.url)),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [privateNetworkAccessPlugin(), emitLoaderPlugin(), emitArchitecturePagePlugin()],
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
        // app chunk 加內容 hash：main.js（loader 以 ?v= 取新）會指向最新的 app-<hash>.js，
        // 避免更新後瀏覽器拿到「新 main.js + 舊 app.js」。部署時舊 chunk 要保留一段時間，
        // 讓仍快取舊 main.js 的分頁可以載入。
        chunkFileNames: 'assets/[name]-[hash].js',
        // 圖片等 asset 加 content hash：內容變更時檔名跟著變，避免瀏覽器讀到舊快取。
        // main.js 不加 hash（loader 用固定 URL + ?v= 破快取），會自動引用到最新的 hash 檔名。
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
});
