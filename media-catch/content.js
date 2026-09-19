/* =========================================================
   MediaCatch — content script
   تشخیص رسانه‌های قابل دانلود (تصویر / ویدیو / صدا / استریم)
   + دکمه شناور هنگام هاور + پنل «رسانه‌های صفحه»
   دانلود با زنجیره: background → fetch داخل صفحه
   ========================================================= */
(() => {
  'use strict';
  if (window.__mediaCatchLoaded) return;
  window.__mediaCatchLoaded = true;

  /* ---------------- تعاریف ---------------- */

  const TYPE_RE = {
    image: /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?)(\?.*)?$/i,
    audio: /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|mid|midi)(\?.*)?$/i,
    video: /\.(mp4|m4v|webm|mov|mkv|avi|3gp|ogv)(\?.*)?$/i,
    stream: /\.(m3u8|mpd|ts)(\?.*)?$/i,
  };
  const TYPE_LABEL = { image: 'تصویر', audio: 'صوت', video: 'ویدیو', stream: 'استریم' };
  const TYPE_ICON = { image: '🖼️', audio: '🎵', video: '🎬', stream: '📡' };
  const TYPE_EXT = { image: '.png', audio: '.mp3', video: '.mp4', stream: '.m3u8' };
  const EXT_SET =
    /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?|mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|mp4|m4v|webm|mov|mkv|avi|3gp|ogv|m3u8|mpd|ts)(\?.*)?$/i;

  const settings = {
    enabled: true,
    hoverButton: true,
    minImageSize: 64,
    saveAs: false,
    siteMode: 'all',
    allowed: [],
    blocked: [],
  };

  const items = new Map(); // url -> item
  const elBest = new Map(); // el -> { url, score } بهترین آدرس برای هر المان
  const pendingDls = new Map(); // token -> resolve(result)
  let dlSeq = 1;
  let nextId = 1;
  let hoveredEl = null;
  let filterType = 'all';
  let panelOpen = false;
  let scanTimer = null;
  let statsTimer = null;
  let floatEl = null;
  let fabEl = null;
  let panelEl = null;
  let toastEl = null;
  let currentFloatItem = null;

  /* ---------------- ابزارها ---------------- */

  const normUrl = (u, base) => {
    try {
      return new URL(String(u).trim(), base).href;
    } catch (e) {
      return null;
    }
  };
  const typeOf = (u) => {
    for (const t of ['stream', 'video', 'audio', 'image']) if (TYPE_RE[t].test(u)) return t;
    return null;
  };
  const isDataOrBlob = (u) => u.startsWith('data:') || u.startsWith('blob:');

  function isPageActive() {
    try {
      return mbdSiteScope.mbdIsSiteScopeActive(settings, location.href);
    } catch (e) {
      return true;
    }
  }

  function isExtensionActive() {
    return settings.enabled && isPageActive();
  }

  function makeName(url, type) {
    const t = type || typeOf(url) || 'image';
    if (!/^https?:/.test(url)) return 'media_' + t + '_' + Date.now().toString(36) + TYPE_EXT[t];
    let base = '';
    try {
      base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    } catch (e) {}
    base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 90);
    const extInBase = /\.[a-z0-9]{2,5}$/i.test(base);
    if (base && extInBase) return base;
    return (base || 'media_' + t + '_' + Date.now().toString(36)) + TYPE_EXT[t];
  }

  function markEl(el) {
    if (el && el.setAttribute) el.setAttribute('data-mbd', '1');
  }

  function scoreEl(el, url, priority, w, h) {
    if (!el) return;
    const score = (priority || 0) * 1000000 + (w || 0) * (h || 0);
    const cur = elBest.get(el);
    if (!cur || score > cur.score) elBest.set(el, { url, score });
  }
  const bestUrlFor = (el) => (elBest.get(el) || {}).url || null;

  function register(url, type, w, h, el, priority) {
    priority = priority || 0;
    if (!url || url.length > 2500) return;
    if (url.startsWith('about:') || url.startsWith('chrome-extension:')) return;
    // blob فقط برای ویدیو/صدا (پلی‌رهای MSE) معنا داره
    if (isDataOrBlob(url) && !(el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO'))) return;
    if (!isPageActive()) return;

    const t =
      type ||
      typeOf(url) ||
      (el && el.tagName === 'IMG'
        ? 'image'
        : el && el.tagName === 'VIDEO'
          ? 'video'
          : el && el.tagName === 'AUDIO'
            ? 'audio'
            : 'image');

    // فیلتر تصویرهای خیلی کوچک (آیکون و پیکسل‌های ردیابی)
    if (t === 'image') {
      const nw = el ? el.naturalWidth || 0 : 0;
      if (nw && nw < settings.minImageSize) return;
      if (w && h && Math.max(w, h) < settings.minImageSize) return;
    }

    const existing = items.get(url);
    if (existing) {
      if (el) {
        existing.el = el;
        markEl(el);
      }
      if (w) existing.w = Math.max(existing.w || 0, w);
      if (h) existing.h = Math.max(existing.h || 0, h);
      scoreEl(el, url, priority, w, h);
      return;
    }

    const item = {
      id: 'm' + nextId++,
      url,
      type: t,
      name: makeName(url, t),
      w: w || 0,
      h: h || 0,
      el: el || null,
    };
    items.set(url, item);
    if (el) {
      markEl(el);
      scoreEl(el, url, priority, w, h);
    }
    scheduleStats();
  }

  /* ---------------- اسکن صفحه ---------------- */

  function extractBg(el, cssText) {
    const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    let m;
    while ((m = re.exec(cssText))) {
      const u = normUrl(m[1].trim(), location.href);
      if (u && typeOf(u)) {
        const r = el.getBoundingClientRect();
        register(u, typeOf(u), Math.round(r.width), Math.round(r.height), el, 1);
      }
    }
  }

  function collect(opts) {
    if (!settings.enabled || !isPageActive()) return;
    const links = opts ? opts.links !== false : true;
    const deep = opts ? !!opts.deep : false;

    // تصاویر (با پشتیبانی از lazy-load)
    document.querySelectorAll('img').forEach((el) => {
      let main = null;
      if (el.currentSrc && !el.currentSrc.startsWith('data:')) main = el.currentSrc;
      else if (el.src && !el.src.startsWith('data:') && el.src !== 'about:blank') main = el.src;
      const w = el.naturalWidth || parseInt(el.getAttribute('width'), 10) || 0;
      const h = el.naturalHeight || parseInt(el.getAttribute('height'), 10) || 0;
      if (main) register(main, 'image', w, h, el, 10);
      [
        'data-src',
        'data-original',
        'data-lazy-src',
        'data-lazy',
        'data-lazyload',
        'data-full-url',
        'data-url',
      ].forEach((a) => {
        const v = el.getAttribute(a);
        if (v && !v.startsWith('data:') && v !== main) register(normUrl(v, location.href), 'image', w, h, el, 4);
      });
    });

    // ویدیوها
    document.querySelectorAll('video').forEach((el) => {
      const w = el.videoWidth || el.clientWidth || 0;
      const h = el.videoHeight || el.clientHeight || 0;
      const main = el.currentSrc || (el.src && el.src !== 'about:blank' ? el.src : null);
      if (main) {
        if (main.startsWith('blob:')) {
          const yid = getYouTubeVideoId();
          if (yid) {
            registerYtItem(yid, el, w, h); // blob یوتیوب (MSE) → استریکتر
            return;
          }
          register(main, 'video', w, h, el, 10); // blob سایت‌های دیگر (ممکن است قابل fetch باشد)
        } else {
          register(main, typeOf(main) === 'stream' ? 'stream' : 'video', w, h, el, 10);
        }
      }
      el.querySelectorAll('source').forEach((s) => {
        const u = normUrl(s.getAttribute('src') || s.src, location.href);
        if (u) register(u, typeOf(u) === 'stream' ? 'stream' : 'video', w, h, el, 5);
      });
      if (el.poster) register(normUrl(el.poster, location.href), 'image', w, h, el, 1);
    });

    // صداها
    document.querySelectorAll('audio').forEach((el) => {
      const main = el.currentSrc || (el.src && el.src !== 'about:blank' ? el.src : null);
      if (main) register(main, typeOf(main) === 'stream' ? 'stream' : 'audio', 0, 0, el, 10);
      el.querySelectorAll('source').forEach((s) => {
        const u = normUrl(s.getAttribute('src') || s.src, location.href);
        if (u) register(u, typeOf(u) === 'stream' ? 'stream' : 'audio', 0, 0, el, 5);
      });
    });

    if (links) {
      // تصاویر پس‌زمینه با استایل inline
      document.querySelectorAll('[style]').forEach((el) => {
        const st = el.getAttribute('style');
        if (st && /url\(/i.test(st)) extractBg(el, st);
      });
      // لینک‌های مستقیم به فایل رسانه
      document.querySelectorAll('a[href]').forEach((el) => {
        const u = normUrl(el.getAttribute('href'), location.href);
        if (u && EXT_SET.test(u) && !isDataOrBlob(u)) register(u, typeOf(u), 0, 0, el, 2);
      });
    }

    if (deep) deepScanBg();
  }

  // اسکن عمیق: بررسی computed-style همه المان‌ها برای تصویر پس‌زمینه
  function deepScanBg() {
    const els = document.querySelectorAll('*');
    const cap = Math.min(els.length, 5000);
    let found = 0;
    for (let i = 0; i < cap; i++) {
      const el = els[i];
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TITLE') continue;
      let bg = '';
      try {
        bg = getComputedStyle(el).backgroundImage;
      } catch (e) {
        continue;
      }
      if (bg && bg !== 'none') {
        const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
        let m;
        while ((m = re.exec(bg))) {
          const u = normUrl(m[1].trim(), location.href);
          if (u && typeOf(u)) {
            const r = el.getBoundingClientRect();
            const before = items.size;
            register(u, typeOf(u), Math.round(r.width), Math.round(r.height), el, 1);
            if (items.size > before) found++;
          }
        }
      }
    }
    if (found) toast('🔍 ' + found + ' تصویر پس‌زمینه پیدا شد');
  }

  function scheduleScan(opts) {
    if (!isExtensionActive()) return;
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      collect(opts || {});
      updateFabCount();
      if (panelOpen) renderPanel();
    }, 700);
  }

  /* ---------------- دکمه شناور (هاور) ---------------- */

  function ensureFloat() {
    if (floatEl) return floatEl;
    floatEl = document.createElement('div');
    floatEl.id = 'mbd-float';
    floatEl.hidden = true;
    const ic = document.createElement('span');
    ic.className = 'mbd-float-icon';
    const tx = document.createElement('span');
    tx.className = 'mbd-float-text';
    const btn = document.createElement('button');
    btn.className = 'mbd-float-dl';
    btn.textContent = '⬇';
    btn.title = 'دانلود';
    floatEl.append(ic, tx, btn);
    floatEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentFloatItem) download(currentFloatItem, btn);
    });
    (document.body || document.documentElement).appendChild(floatEl);
    return floatEl;
  }

  function showFloat(el, item) {
    if (!settings.hoverButton) return;
    hoveredEl = el;
    currentFloatItem = item;
    const f = ensureFloat();
    f.hidden = false;
    if (item.special === 'youtube') {
      f.querySelector('.mbd-float-icon').textContent = '📺';
      f.querySelector('.mbd-float-text').textContent = 'یوتیوب · دانلود 720p';
    } else {
      f.querySelector('.mbd-float-icon').textContent = TYPE_ICON[item.type] || '⬇';
      f.querySelector('.mbd-float-text').textContent =
        (TYPE_LABEL[item.type] || 'فایل') +
        (item.w && item.h ? ' · ' + item.w + '×' + item.h : '') +
        ' · دانلود';
    }
    positionFloat(el);
  }

  function positionFloat(el) {
    if (!floatEl || floatEl.hidden) return;
    const r = el.getBoundingClientRect();
    const fr = floatEl.getBoundingClientRect();
    let x = Math.max(8, r.right - fr.width);
    let y = r.top - fr.height - 6;
    if (y < 8) y = Math.min(r.top + 6, innerHeight - fr.height - 8);
    if (x + fr.width > innerWidth - 8) x = innerWidth - fr.width - 8;
    floatEl.style.left = x + 'px';
    floatEl.style.top = Math.max(8, y) + 'px';
  }

  function hideFloat() {
    hoveredEl = null;
    currentFloatItem = null;
    if (floatEl) floatEl.hidden = true;
  }

  document.addEventListener(
    'mouseover',
    (e) => {
      if (!isExtensionActive()) return;
      const t = e.target;
      const el = t && typeof t.closest === 'function' ? t.closest('[data-mbd]') : null;
      if (!el) return;
      const url = bestUrlFor(el);
      const item = items.get(url);
      if (item) showFloat(el, item);
    },
    true
  );

  document.addEventListener(
    'mouseout',
    (e) => {
      const t = e.target;
      const el = t && typeof t.closest === 'function' ? t.closest('[data-mbd]') : null;
      if (!el || hoveredEl !== el) return;
      const rel = e.relatedTarget;
      if (rel && el.contains(rel)) return;
      if (floatEl && (rel === floatEl || floatEl.contains(rel))) return;
      hideFloat();
    },
    true
  );

  addEventListener(
    'scroll',
    () => {
      if (hoveredEl) positionFloat(hoveredEl);
    },
    { passive: true, capture: true }
  );
  addEventListener(
    'resize',
    () => {
      if (hoveredEl) positionFloat(hoveredEl);
      clampEl(fabEl);
      if (panelEl && !panelEl.hidden) clampEl(panelEl);
    },
    { passive: true }
  );

  /* ---------------- دکمه شناور پنل (FAB) ---------------- */

  /* ---------- drag & جابجایی با موس ---------- */

  let uiPos = { fab: null, panel: null };
  try {
    chrome.storage.local.get(['mbdUi'], (r) => {
      uiPos = Object.assign({ fab: null, panel: null }, (r && r.mbdUi) || {});
      if (fabEl) applyUiPos('fab');
      if (panelEl && !panelEl.hidden) applyUiPos('panel');
    });
  } catch (e) {}

  function saveUiPos(key) {
    try {
      const el = key === 'fab' ? fabEl : panelEl;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ui = Object.assign({}, uiPos);
      ui[key] = { x: Math.round(r.left), y: Math.round(r.top) };
      chrome.storage.local.set({ mbdUi: ui });
    } catch (e) {}
  }

  function applyUiPos(key) {
    const el = key === 'fab' ? fabEl : panelEl;
    const p = uiPos[key];
    if (!el || !p) return;
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const x = Math.max(4, Math.min(p.x, innerWidth - Math.max(w, 40) - 4));
    const y = Math.max(4, Math.min(p.y, innerHeight - Math.max(h, 40) - 4));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function clampEl(el) {
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 4 || r.bottom > innerHeight - 4 || r.left < 4 || r.top < 4) {
      const x = Math.max(4, Math.min(r.left, innerWidth - w - 4));
      const y = Math.max(4, Math.min(r.top, innerHeight - h - 4));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  }

  function resetUiPos(key) {
    const el = key === 'fab' ? fabEl : panelEl;
    if (!el) return;
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    const ui = Object.assign({}, uiPos);
    ui[key] = null;
    uiPos = ui;
    try {
      chrome.storage.local.set({ mbdUi: ui });
    } catch (e) {}
  }

  const justDragged = (el) => !!(el && el._mbdDragEnd && Date.now() - el._mbdDragEnd < 400);

  function makeDraggable(handle, target, key) {
    let dragging = false;
    let moved = false;
    let sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // از روی دکمه/فیلد شروع نشه
      if (e.target.closest && e.target.closest('button,select,input,textarea,a')) return;
      dragging = true;
      moved = false;
      const r = target.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      sx = e.clientX;
      sy = e.clientY;
      e.preventDefault();
    });
    document.addEventListener(
      'mousemove',
      (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx;
        const dy = e.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        const w = target.offsetWidth, h = target.offsetHeight;
        const x = Math.max(4, Math.min(ox + dx, innerWidth - w - 4));
        const y = Math.max(4, Math.min(oy + dy, innerHeight - h - 4));
        target.style.left = x + 'px';
        target.style.top = y + 'px';
        target.style.right = 'auto';
        target.style.bottom = 'auto';
      },
      { passive: true }
    );
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (moved) {
        target._mbdDragEnd = Date.now();
        saveUiPos(key);
      }
    });
    // دابل‌کلیک → برگشت به جای پیش‌فرض
    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest && e.target.closest('button,select')) return;
      resetUiPos(key);
    });
  }

  function ensureFab() {
    if (fabEl) return fabEl;
    fabEl = document.createElement('div');
    fabEl.id = 'mbd-fab';
    fabEl.title = 'رسانه‌های صفحه (MediaCatch) — Alt+Shift+D | با موس بکش تا جابجا کنی';
    const ic = document.createElement('span');
    ic.className = 'mbd-fab-icon';
    ic.textContent = '📥';
    const cnt = document.createElement('span');
    cnt.className = 'mbd-fab-count';
    fabEl.append(ic, cnt);
    fabEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (justDragged(fabEl)) return;
      togglePanel();
    });
    (document.body || document.documentElement).appendChild(fabEl);
    applyUiPos('fab');
    makeDraggable(fabEl, fabEl, 'fab');
    return fabEl;
  }

  function updateFabCount() {
    if (!fabEl) return;
    const c = fabEl.querySelector('.mbd-fab-count');
    c.textContent = String(items.size);
    c.style.display = items.size ? 'flex' : 'none';
    fabEl.style.display = isExtensionActive() ? 'flex' : 'none';
  }

  /* ---------------- پنل رسانه‌ها ---------------- */

  function iconBtn(txt, title) {
    const b = document.createElement('button');
    b.className = 'mbd-icon-btn';
    b.textContent = txt;
    b.title = title;
    return b;
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'mbd-panel';
    panelEl.hidden = true;

    const head = document.createElement('div');
    head.className = 'mbd-panel-head';
    const title = document.createElement('span');
    title.className = 'mbd-panel-title';
    const bRescan = iconBtn('↻', 'بازرسی دوباره صفحه');
    const bDeep = iconBtn('🔍', 'اسکن عمیق (تصاویر پس‌زمینه)');
    const bClose = iconBtn('✕', 'بستن');
    head.append(title, bRescan, bDeep, bClose);

    const chips = document.createElement('div');
    chips.className = 'mbd-chips';
    [
      ['all', 'همه'],
      ['image', '🖼️ تصویر'],
      ['video', '🎬 ویدیو'],
      ['audio', '🎵 صدا'],
      ['stream', '📡 استریم'],
    ].forEach(([k, label]) => {
      const b = document.createElement('button');
      b.className = 'mbd-chip' + (k === filterType ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        filterType = k;
        chips.querySelectorAll('.mbd-chip').forEach((c) => c.classList.remove('active'));
        b.classList.add('active');
        renderPanel();
      });
      chips.appendChild(b);
    });

    const list = document.createElement('div');
    list.className = 'mbd-panel-list';

    const foot = document.createElement('div');
    foot.className = 'mbd-panel-foot';
    const info = document.createElement('span');
    info.className = 'mbd-panel-info';
    const bAll = document.createElement('button');
    bAll.className = 'mbd-dl';
    bAll.textContent = '⬇ دانلود همه';
    bAll.addEventListener('click', () => downloadAll());
    foot.append(info, bAll);

    panelEl.append(head, chips, list, foot);

    bRescan.addEventListener('click', () => {
      collect({ deep: true });
      renderPanel();
    });
    bDeep.addEventListener('click', () => {
      deepScanBg();
      renderPanel();
    });
    bClose.addEventListener('click', () => togglePanel(false));

    (document.body || document.documentElement).appendChild(panelEl);
    panelEl._title = title;
    panelEl._list = list;
    panelEl._info = info;
    head.title = 'با کشیدن، پنل را جابجا کن';
    applyUiPos('panel');
    makeDraggable(head, panelEl, 'panel');
    return panelEl;
  }

  function togglePanel(force) {
    if (!isExtensionActive()) return;
    ensurePanel();
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    panelEl.hidden = !panelOpen;
    if (panelOpen) renderPanel();
  }

  function filteredItems() {
    return [...items.values()].filter((it) => filterType === 'all' || it.type === filterType);
  }

  function renderPanel() {
    if (!panelOpen) return;
    const p = ensurePanel();
    const list = filteredItems();
    p._title.textContent = 'رسانه‌های صفحه (' + items.size + ')';
    p._list.innerHTML = '';
    const show = list.slice(0, 100);
    if (!show.length) {
      const empty = document.createElement('div');
      empty.className = 'mbd-panel-empty';
      empty.textContent = 'چیزی پیدا نشد. دکمه 🔍 را بزنید تا تصاویر پس‌زمینه هم اسکن شوند.';
      p._list.appendChild(empty);
    }
    for (const it of show) {
      const row = document.createElement('div');
      row.className = 'mbd-row';
      const isYt = it.special === 'youtube';
      const ic = document.createElement('span');
      ic.className = 'mbd-row-icon';
      ic.textContent = isYt ? '📺' : TYPE_ICON[it.type] || '📎';
      const meta = document.createElement('div');
      meta.className = 'mbd-row-meta';
      const name = document.createElement('div');
      name.className = 'mbd-row-name';
      name.textContent = isYt ? 'ویدیوی یوتیوب' : it.name;
      name.title = it.url;
      const sub = document.createElement('div');
      sub.className = 'mbd-row-sub';
      sub.textContent = isYt
        ? 'ID: ' + it.videoId
        : (TYPE_LABEL[it.type] || it.type) + (it.w && it.h ? ' · ' + it.w + '×' + it.h : '');
      meta.append(name, sub);
      const btn = document.createElement('button');
      btn.className = 'mbd-dl';
      btn.textContent = '⬇';
      btn.title = isYt ? 'دانلود از یوتیوب' : it.url;
      if (isYt) {
        const sel = document.createElement('select');
        sel.className = 'mbd-sel';
        sel.innerHTML =
          '<option value="v720">ویدیو 720p</option>' +
          '<option value="v360">ویدیو 360p</option>' +
          '<option value="audio">🎵 صدا فقط</option>';
        sel.addEventListener('click', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          youtubeDownload(it, btn, sel.value);
        });
        row.append(ic, meta, sel, btn);
      } else {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          download(it, btn);
        });
        row.append(ic, meta, btn);
      }
      p._list.appendChild(row);
    }
    if (list.length > 100) {
      const more = document.createElement('div');
      more.className = 'mbd-panel-empty';
      more.textContent = '+ ' + (list.length - 100) + ' مورد دیگر…';
      p._list.appendChild(more);
    }
    p._info.textContent = 'نمایش ' + Math.min(list.length, 100) + ' از ' + list.length + ' مورد';
  }

  async function downloadAll() {
    const list = filteredItems().slice(0, 30);
    if (!list.length) {
      toast('موردی برای دانلود نیست', true);
      return;
    }
    toast('در حال ارسال ' + list.length + ' دانلود…');
    for (const it of list) {
      download(it);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /* ---------------- دانلود (زنجیره‌ای) ---------------- */

  function markBtn(btn, state) {
    if (!btn) return;
    if (state === 'busy') {
      btn.classList.remove('mbd-done', 'mbd-err');
      btn.textContent = '…';
    } else if (state === 'done') {
      btn.classList.remove('mbd-err');
      btn.classList.add('mbd-done');
      btn.textContent = '✓';
      setTimeout(() => {
        btn.classList.remove('mbd-done');
        btn.textContent = '⬇';
      }, 1800);
    } else if (state === 'err') {
      btn.classList.remove('mbd-done');
      btn.classList.add('mbd-err');
      btn.textContent = '✗';
      setTimeout(() => {
        btn.classList.remove('mbd-err');
        btn.textContent = '⬇';
      }, 2600);
    }
  }

  // روش جایگزین ۳: fetch در context خود صفحه (با کوکی و referer اصلی صفحه)
  async function inPageDownload(url, name, btn) {
    try {
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const burl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = burl;
      a.download = name;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(burl), 5000);
      toast('⬇ دانلود شروع شد: ' + name);
      markBtn(btn, 'done');
      return true;
    } catch (e) {
      toast(
        'دانلود ناموفق بود: ' +
          ((e && e.message) || e) +
          ' — سرور ممکن است دسترسی خارج از صفحه را محدود کرده است',
        true
      );
      markBtn(btn, 'err');
      return false;
    }
  }

  // پیام به background با پروتکل ack + result
  function requestMessage(type, payload) {
    return new Promise((resolve) => {
      let settled = false;
      const token = 'c' + dlSeq++;
      const finish = (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pendingDls.delete(token);
        resolve(res || { ok: false, error: 'no-response' });
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'ack-timeout' }), 3000);
      pendingDls.set(token, finish);
      try {
        chrome.runtime.sendMessage(Object.assign({ type, token }, payload || {}), (res) => {
          if (res && res.ack) return; // نتیجه اصلی با mbd:download-result می‌رسد
          finish(res);
        });
      } catch (e) {
        finish({ ok: false, error: (e && e.message) || String(e) });
      }
    });
  }

  // دانلود ویدیوی یوتیوب با استریکتر (API innerTube) در background
  async function youtubeDownload(item, btn, quality) {
    quality = quality || 'v720';
    markBtn(btn, 'busy');
    const res = await requestMessage('mbd:youtube', { videoId: item.videoId, quality, source: location.href });
    if (res && res.ok) {
      toast('⬇ دانلود شروع شد: ' + (res.name || item.name));
      markBtn(btn, 'done');
      return true;
    }
    toast('دانلود یوتیوب ناموفق بود: ' + ((res && res.error) || 'خطای نامشخص'), true);
    markBtn(btn, 'err');
    return false;
  }

  async function download(item, btn) {
    if (!item) return false;
    if (item.special === 'youtube') return youtubeDownload(item, btn);
    if (isDataOrBlob(item.url)) return inPageDownload(item.url, item.name, btn);

    markBtn(btn, 'busy');
    const res = await requestMessage('mbd:download', { url: item.url, filename: item.name, source: location.href });
    if (res && res.ok) {
      toast('⬇ دانلود شروع شد: ' + item.name + (res.via === 'fetch' ? ' (روش جایگزین)' : ''));
      markBtn(btn, 'done');
      return true;
    }

    // background نتونست → fetch در context خود صفحه
    const ok = await inPageDownload(item.url, item.name, btn);
    return ok;
  }

  /* ---------------- toast ---------------- */

  function toast(msg, isErr) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'mbd-toast';
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle('mbd-toast-err', !!isErr);
    toastEl.classList.add('mbd-show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('mbd-show'), isErr ? 5500 : 2800);
  }

  /* ---------------- آمار برای نشانگر تب ---------------- */

  function scheduleStats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      try {
        chrome.runtime.sendMessage({ type: 'mbd:stats', count: items.size }, () => void chrome.runtime.lastError);
      } catch (e) {}
    }, 350);
  }

  /* ---------------- تنظیمات ---------------- */

  function applySettings() {
    const active = isExtensionActive();
    if (!active) {
      hideFloat();
      if (fabEl) fabEl.style.display = 'none';
      if (panelEl) panelEl.hidden = true;
      panelOpen = false;
      items.clear();
      elBest.clear();
    } else {
      ensureFab();
      updateFabCount();
      collect({});
    }
    scheduleStats();
  }

  try {
    chrome.storage.local.get(['mbdSettings'], (res) => {
      Object.assign(settings, (res && res.mbdSettings) || {});
      applySettings();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.mbdSettings) {
        Object.assign(settings, changes.mbdSettings.newValue || {});
        applySettings();
        if (panelOpen) renderPanel();
      }
    });
  } catch (e) {}

  /* ---------------- شروع ---------------- */

  new MutationObserver(() => scheduleScan({})).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // اسکن دوره‌ای سبک برای ویدیو/صواری که بعداً بارگذاری می‌شوند (blob و lazy)
  setInterval(
    () => {
      if (!settings.enabled || !isPageActive()) return;
      collect({ links: false });
      updateFabCount();
    },
    5000
  );

  function boot() {
    applySettings();
    collect({});
    updateFabCount();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.addEventListener('load', () => {
    collect({});
    updateFabCount();
  });

  // میانبرهای کلیدهای میانبر
  try {
    chrome.commands.onCommand.addListener((cmd) => {
      if (!isExtensionActive()) return;
      if (cmd === 'mbd-download-current') {
        if (hoveredEl) {
          const it = items.get(bestUrlFor(hoveredEl));
          if (it) return download(it);
        }
        toast('نشانگر را روی یک رسانه نگه دارید (یا پنل 📥 را باز کنید)', true);
      } else if (cmd === 'mbd-toggle-panel') {
        togglePanel();
      }
    });
  } catch (e) {}

  // پیام‌ها (popup + نتیجه دانلود از background)
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'mbd:download-result') {
        const f = pendingDls.get(msg.token);
        if (f) f(msg);
        else if (msg.retried) toast('⬇ دانلود با روش جایگزین شروع شد: ' + (msg.name || ''));
        return false;
      }
      if (msg.type === 'mbd:ping') {
        const siteActive = isExtensionActive();
        const list = siteActive ? [...items.values()].slice(0, 40) : [];
        sendResponse({
          ok: true,
          siteActive,
          count: siteActive ? items.size : 0,
          items: list.map((it) => ({
            url: it.url,
            type: it.type,
            name: it.name,
            w: it.w,
            h: it.h,
            special: it.special || null,
            videoId: it.videoId || null,
          })),
        });
      } else if (msg.type === 'mbd:rescan') {
        collect({ deep: true });
        updateFabCount();
        sendResponse({ ok: true, count: items.size });
      } else if (msg.type === 'mbd:togglePanel') {
        togglePanel();
        sendResponse({ ok: true });
      } else if (msg.type === 'mbd:youtubeItem') {
        const it =
          items.get('yt:' + msg.videoId) ||
          [...items.values()].find((x) => x.special === 'youtube' && x.videoId === msg.videoId);
        if (it) {
          youtubeDownload(it, null, msg.quality);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'youtube item not found' });
        }
      } else if (msg.type === 'mbd:downloadItem') {
        const it = items.get(msg.url);
        if (it) {
          download(it);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: 'item not found' });
        }
      }
      return false;
    });
  } catch (e) {}
})();
