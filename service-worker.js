// 缓存版本标识，更新时修改此值以触发缓存更新
const CACHE_VERSION = 'v1';
const CACHE_NAME = `habit-tracker-${CACHE_VERSION}`;

// 需要缓存的资源列表
const STATIC_CACHE_URLS = [
  './index.html',
  './manifest.json',
  // 第三方依赖
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js'
];

// 安装阶段：预缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('打开缓存');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => self.skipWaiting()) // 强制新SW立即激活
  );
});

// 激活阶段：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.filter((cacheName) => {
            // 删除旧版本缓存
            return cacheName.startsWith('habit-tracker-') && cacheName !== CACHE_NAME;
          }).map((cacheName) => {
            console.log('删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          })
        );
      })
      .then(() => self.clients.claim()) // 控制未受控制的客户端
  );
});

// 资源请求阶段：实现缓存优先策略，网络回退
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 对于API请求使用网络优先策略
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
  } 
  // 对于静态资源使用缓存优先策略
  else {
    event.respondWith(cacheFirst(event.request));
  }
});

// 缓存优先策略
async function cacheFirst(request) {
  // 尝试从缓存获取资源
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // 缓存未命中，从网络获取
  try {
    const networkResponse = await fetch(request);
    
    // 只缓存成功的GET请求响应
    if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
      // 复制响应以避免双重消费
      const responseToCache = networkResponse.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, responseToCache);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('网络请求失败:', error);
    
    // 对于HTML请求，返回离线页面
    if (request.headers.get('accept').includes('text/html')) {
      return caches.match('./index.html');
    }
    
    // 返回404响应
    return new Response('Network error happened', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 网络优先策略
async function networkFirst(request) {
  try {
    // 优先尝试从网络获取
    const networkResponse = await fetch(request);
    
    // 更新缓存
    if (networkResponse && networkResponse.status === 200) {
      const responseToCache = networkResponse.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, responseToCache);
    }
    
    return networkResponse;
  } catch (error) {
    console.error('网络请求失败，使用缓存:', error);
    
    // 网络失败时尝试从缓存获取
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 返回离线响应
    return new Response('您当前处于离线状态，无法获取最新数据', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 后台同步事件，用于在重新联网时同步数据
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-habits-data') {
    event.waitUntil(syncHabitsData());
  }
});

// 数据同步函数
async function syncHabitsData() {
  try {
    // 获取所有客户端
    const clients = await self.clients.matchAll();
    
    // 通知客户端进行数据同步
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_DATA' });
    });
    
    console.log('数据同步完成');
  } catch (error) {
    console.error('数据同步失败:', error);
  }
}

// 推送通知事件
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || '该打卡了！',
      icon: './icons/icon-192x192.svg',
      badge: './icons/icon-72x72.svg',
      data: {
        url: data.url || './index.html'
      },
      actions: [
        {
          action: 'checkin',
          title: '去打卡'
        },
        {
          action: 'later',
          title: '稍后提醒'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || '习惯打卡提醒', options)
    );
  } catch (error) {
    console.error('推送通知处理失败:', error);
  }
});

// 通知点击事件
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data.url;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 如果已有打开的窗口，则导航到该窗口
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // 否则打开新窗口
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});