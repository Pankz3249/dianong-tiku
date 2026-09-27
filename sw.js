// Service Worker - 电工技能大赛理论题库练习软件
// 预缓存应用壳（HTML/JS/CSS/图标/数据），使 PWA 可离线安装与运行。
//
// ⚠️ 重要：fetch 策略为「网络优先（network-first）」。
// 之前用「缓存优先」导致更新后用户仍看到旧版本（加 Ctrl+F5 也未必生效），
// 因为 SW 拦截请求后直接返回了本地缓存，根本没去服务器取新文件。
// 现在改为：联网时优先取网络最新内容并回填缓存；断网时才回退到缓存。
const APP_PREFIX = 'dianong_tiku_';
const VERSION = 'dianong_v2_0';
const CACHE_NAME = APP_PREFIX + VERSION;
// ⚠️ 全部使用【相对路径】：部署到 Gitee Pages / GitHub Pages 时站点位于子目录
//    （如 https://用户名.gitee.io/仓库名/），若写绝对路径 '/' 会缓存失败。
//    相对路径以 sw.js 所在目录为基准，根目录部署与子目录部署都能正确工作。
const URLS = [
  './', './index.html',
  './app.js', './data.js',
  './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  './icon-192-maskable.png', './icon-512-maskable.png',
  './ref_photo1.jpg', './ref_photo2.jpg', './ref_photo3.jpg',
  './ref_comp1.jpg', './ref_comp2.jpg', './ref_comp3.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 清理所有旧版本缓存，保证更新后不留旧文件
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 允许页面主动触发更新：收到 {type:'SKIP_WAITING'} 立即激活新 SW
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // ① 网络优先：先尝试取最新内容
      const res = await fetch(e.request);
      if (res && res.status === 200) {
        cache.put(e.request, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      // ② 断网/失败：回退到缓存（保证离线可用）
      const cached = await cache.match(e.request);
      if (cached) return cached;
      // ③ 缓存也没有：导航请求回退到首页
      if (e.request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
