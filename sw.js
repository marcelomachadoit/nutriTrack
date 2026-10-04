const CACHE_NAME = 'nutritrack-static-v34';
// Caches do app com nome antigo (fitlab-*) ou versões anteriores deste são removidos na ativação.
const STATIC_FILES = ['./', './index.html', './js/migrate.js', './css/style.css', './js/app.js', './js/ui.js', './js/auth.js', './js/foods.js', './js/meals.js', './js/recipes.js', './js/goals.js', './js/weight.js', './js/fit.js', './js/fit-ui.js', './js/fit-stats.js', './js/i18n.js', './js/supabase.js', './manifest.json', './logo.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_FILES))); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
	event.waitUntil(caches.keys()
		.then((nomes) => Promise.all(nomes
			.filter((nome) => nome !== CACHE_NAME && /^(fitlab|nutritrack)-static-/.test(nome))
			.map((nome) => caches.delete(nome))))
		.then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);
	if (requestUrl.origin !== self.location.origin) return;

	// Sempre procura uma versão nova do HTML; o cache fica apenas como fallback offline.
	if (event.request.mode === 'navigate' || requestUrl.pathname.endsWith('.html')) {
		event.respondWith(fetch(event.request).then((response) => {
			const copy = response.clone();
			caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
			return response;
		}).catch(() => caches.match(event.request)));
		return;
	}

	event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
