/* =========================================================
   MediaCatch — background service worker (MV3)
   مدیریت دانلودها با زنجیره fallback:
     ۱) دانلود مستقیم
     ۲) fetch در context افزونه (با Cookie + Referer صفحه)
     ۳) (در content script) fetch داخل خود صفحه
   + منوی راست‌کلیک + نشانگر تب + تاریخچه
   ========================================================= */
'use strict';

const DEFAULTS = {
  enabled: true,
  hoverButton: true,
  minImageSize: 64,
  saveAs: false,
  blocked: [],
};

const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?|mp3|wav|ogg|oga|opus|flac|m4a|aac|wma|mp4|m4v|webm|mov|mkv|avi|3gp|ogv|m3u8|mpd|ts)(\?.*)?$/i;
const TYPE_EXT = { image: '.png', audio: '.mp3', video: '.mp4', stream: '.m3u8' };
const MAX_FETCH_BYTES = 150 * 1024 * 1024; // سقف حجم برای روش جایگزین fetch
const RETRYABLE_REASONS = new Set([
  'SERVER_HTTP_ERROR',
  'BLOCKED',
  'NETWORK_ABORTED',
  'NETWORK_TIMEOUT',
  'FILE_ACCESS_DENIED',
  'FILE_ERROR',
]);
let tokenSeq = 0;

/* ---------------- نصب / منوها ---------------- */

chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get('mbdSettings');
  if (!s.mbdSettings) {
    await chrome.storage.local.set({ mbdSettings: { ...DEFAULTS } });
  }
  buildMenus();
});

chrome.runtime.onStartup.addListener(buildMenus);

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mbd-image', title: 'دانلود تصویر (MediaCatch)', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'mbd-audio', title: 'دانلود صدا (MediaCatch)', contexts: ['audio'] });
    chrome.contextMenus.create({ id: 'mbd-video', title: 'دانلود ویدیو (MediaCatch)', contexts: ['video'] });
    chrome.contextMenus.create({ id: 'mbd-link', title: 'دانلود رسانه (MediaCatch)', contexts: ['link'], visible: false });
  });
}

chrome.contextMenus.onBeforeUpdate.addListener((info) => {
  if (info.menuItemId === 'mbd-link') {
    chrome.contextMenus.update('mbd-link', { visible: MEDIA_EXT.test(info.href || '') });
  }
});

chrome.contextMenus.onClicked.addListener((info) => {
  let url = null;
  if (info.menuItemId === 'mbd-link') url = info.linkUrl;
  else url = info.srcUrl;
  if (!url) return;
  const type = { 'mbd-image': 'image', 'mbd-audio': 'audio', 'mbd-video': 'video' }[info.menuItemId] || null;
  startDownload(url, null, type, null, info.tabId != null ? info.tabId : null, info.frameId || 0);
});

/* ---------------- دانلود ---------------- */

function guessName(url, type) {
  const t = type || 'file';
  if (!/^https?:/.test(url)) return 'media_' + t + '_' + Date.now().toString(36);
  let base = '';
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
  } catch (e) {}
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 90);
  if (!base) base = 'media_' + t + '_' + Date.now().toString(36);
  if (!/\.[a-z0-9]{2,5}$/i.test(base) && TYPE_EXT[t]) base += TYPE_EXT[t];
  return base;
}

async function startDownload(url, filename, type, source, tabId, frameId) {
  const s = await chrome.storage.local.get('mbdSettings');
  const cfg = { ...DEFAULTS, ...(s.mbdSettings || {}) };
  let name = (filename && filename.trim()) || guessName(url, type);
  name = name.split(/[\\/]/).pop().replace(/\.\./g, '_').slice(0, 120) || 'media';

  // روش ۱: دانلود مستقیم (سریع‌ترین)
  const direct = await tryDirect(url, name, cfg.saveAs, source, tabId, frameId);
  if (direct.ok) return { ...direct, via: 'direct' };

  // روش ۲: fetch در context افزونه — با Cookie و Referer صفحه (برای سایت‌های حساس به referer)
  if (/^https?:/i.test(url)) {
    const fb = await tryViaFetch(url, name, source, cfg.saveAs, tabId, frameId);
    if (fb.ok) return { ...fb, via: 'fetch' };
    return { ok: false, error: 'مستقیم: ' + direct.error + ' | جایگزین: ' + fb.error, via: 'both' };
  }

  return { ok: false, error: direct.error || 'دانلود ناموفق بود', via: 'direct' };
}

async function tryDirect(url, name, saveAs, source, tabId, frameId) {
  try {
    const id = await chrome.downloads.download({
      url,
      filename: 'media-catch/' + name,
      saveAs: !!saveAs,
      conflictAction: 'uniquify',
    });
    record(id, url, name, source, 'direct', tabId, frameId);
    return { ok: true, id, name };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function tryViaFetch(url, name, source, saveAs, tabId, frameId) {
  try {
    const init = { credentials: 'include' };
    if (source) {
      init.referrer = source;
      init.referrerPolicy = 'unsafe-url';
    }
    const resp = await fetch(url, init);
    if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
    const len = Number(resp.headers.get('content-length') || 0);
    if (len > MAX_FETCH_BYTES) return { ok: false, error: 'فایل بزرگ‌تر از ۱۵۰MB است' };
    const blob = await resp.blob();
    if (blob.size > MAX_FETCH_BYTES) return { ok: false, error: 'فایل بزرگ‌تر از ۱۵۰MB است' };
    const dataUrl = await blobToDataUrl(blob);
    const id = await chrome.downloads.download({
      url: dataUrl,
      filename: 'media-catch/' + name,
      saveAs: !!saveAs,
      conflictAction: 'uniquify',
    });
    record(id, url, name, source, 'fetch', tabId, frameId);
    return { ok: true, id, name };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

/* ---------------- یوتیوب (استریکتر) ----------------
   از API innerTube فرمت‌های قابل دانلود را می‌گیرد.
   best-effort: یوتیوب گاهی فرمت‌ها را با token خاص محافظت می‌کند. */

const YT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function ytGetPlayer(videoId) {
  const url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  const body = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240115.00.00',
        hl: 'fa',
        gl: 'IR',
        userAgent: YT_UA,
        clientFormFactor: 'UNKNOWN_FORM_FACTOR',
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': YT_UA,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

function ytPickFormat(data, quality) {
  const sd = data.streamingData;
  if (!sd) return null;
  const prog = sd.formats || []; // فرمت‌های تک‌فایلی (mp4 mux)
  const dash = sd.adaptiveFormats || []; // DASH (سپارته)
  const byItag = (list, itag) => list.find((f) => Number(f.itag) === itag && f.url);
  if (quality === 'audio') {
    const a = byItag(dash, 140) || byItag(prog, 140) || byItag(dash, 251);
    if (a) return { url: a.url, ext: /webm/.test(a.mimeType || '') ? 'webm' : 'm4a' };
    return null;
  }
  const want = quality === 'v360' ? [18, 22] : [22, 18, 37];
  for (const it of want) {
    const f = byItag(prog, it);
    if (f) return { url: f.url, ext: 'mp4' };
  }
  return null;
}

async function startYouTubeDownload(videoId, quality, source, tabId, frameId) {
  const s = await chrome.storage.local.get('mbdSettings');
  const cfg = { ...DEFAULTS, ...(s.mbdSettings || {}) };
  try {
    const data = await ytGetPlayer(videoId);
    const ps = data.playabilityStatus;
    if (ps && ps.status && ps.status !== 'OK' && ps.status !== 'LOGIN_REQUIRED') {
      return { ok: false, error: ps.reason || ps.status };
    }
    const fmt = ytPickFormat(data, quality);
    if (!fmt) {
      return {
        ok: false,
        error:
          'فرمت قابل دسترسی پیدا نشد — یوتیوب گاهی لینک مستقیم را پنهان می‌کند (POT token). در این صورت yt-dlp محلی مطمئن‌ترین راه است',
      };
    }
    let title = (data.videoDetails && data.videoDetails.title) || videoId;
    title = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 100);
    const name = title + '.' + fmt.ext;
    const id = await chrome.downloads.download({
      url: fmt.url,
      filename: 'media-catch/' + name,
      saveAs: !!cfg.saveAs,
      conflictAction: 'uniquify',
    });
    record(id, fmt.url, name, source || 'youtube.com', 'youtube', tabId, frameId);
    return { ok: true, id, name };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* ---------------- تاریخچه ---------------- */

async function record(id, url, filename, source, via, tabId, frameId) {
  const s = await chrome.storage.local.get('mbdHistory');
  const h = Array.isArray(s.mbdHistory) ? s.mbdHistory : [];
  h.unshift({
    id,
    url,
    filename,
    source: source || null,
    via: via || 'direct',
    tabId: tabId != null ? tabId : null,
    frameId: frameId || 0,
    state: 'in_progress',
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    size: null,
  });
  await chrome.storage.local.set({ mbdHistory: h.slice(0, 60) });
}

chrome.downloads.onChanged.addListener((delta) => {
  (async () => {
    const s = await chrome.storage.local.get('mbdHistory');
    const h = Array.isArray(s.mbdHistory) ? s.mbdHistory : [];
    const it = h.find((x) => x.id === delta.id);
    if (!it) return;

    let needRetry = null;
    if (delta.state) {
      it.state = delta.state.current;
      if (delta.state.current === 'complete') it.completedAt = Date.now();
      if (delta.state.current === 'interrupted') {
        it.error = delta.state.interruptReason || null;
        // اگر دانلود مستقیم سر‌و‌سر قطع شد (مثلاً 403 / hotlink protection)،
        // خودکار با روش fetch (referer + cookie) دوباره امتحان کن
        if (it.via === 'direct' && RETRYABLE_REASONS.has(it.error)) needRetry = it;
      }
    }
    if (delta.totalBytes && delta.totalBytes.current) it.size = delta.totalBytes.current;
    if (delta.filename && delta.filename.current) it.filename = delta.filename.current.split('/').pop();
    await chrome.storage.local.set({ mbdHistory: h });

    if (needRetry) {
      needRetry.state = 'retrying';
      const cfgS = await chrome.storage.local.get('mbdSettings');
      const cfg = { ...DEFAULTS, ...(cfgS.mbdSettings || {}) };
      const fb = await tryViaFetch(needRetry.url, needRetry.filename, needRetry.source, cfg.saveAs, needRetry.tabId, needRetry.frameId);
      const s2 = await chrome.storage.local.get('mbdHistory');
      const h2 = Array.isArray(s2.mbdHistory) ? s2.mbdHistory : [];
      const r2 = h2.find((x) => x.id === needRetry.id);
      if (r2) {
        r2.state = fb.ok ? 'replaced' : 'interrupted';
        await chrome.storage.local.set({ mbdHistory: h2 });
      }
      if (fb.ok) {
        // اطلاع‌رسانی به content script
        dispatchResult(
          { type: 'mbd:download-result', token: 'retry', ok: true, retried: true, name: needRetry.filename },
          needRetry.tabId,
          needRetry.frameId
        );
      }
    }
  })();
});

/* ---------------- ارسال نتیجه به content/popup ---------------- */

function dispatchResult(payload, tabId, frameId) {
  (async () => {
    if (tabId != null) {
      try {
        await chrome.tabs.sendMessage(tabId, payload, { frameId: frameId || 0 });
      } catch (e) {}
    }
    // برای popup (که tab ندارد) — broadcast بین context های افزونه
    try {
      await chrome.runtime.sendMessage(payload);
    } catch (e) {}
  })();
}

/* ---------------- پیام‌ها ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('mbd:')) return false;
  (async () => {
    try {
      if (msg.type === 'mbd:download') {
        // پاسخ سریع (ack) بده تا content مطمئن بشه؛ نتیجه اصلی جدا ارسال می‌شود
        const tabId = sender.tab ? sender.tab.id : null;
        const frameId = sender.frameId || 0;
        const source = (sender.tab && sender.tab.url) || msg.source || null;
        const token = msg.token || 't' + ++tokenSeq;
        sendResponse({ ack: true, token });
        let res;
        try {
          res = await startDownload(msg.url, msg.filename, null, source, tabId, frameId);
        } catch (e) {
          res = { ok: false, error: (e && e.message) || String(e) };
        }
        dispatchResult({ type: 'mbd:download-result', token, ...res }, tabId, frameId);
      } else if (msg.type === 'mbd:youtube') {
        const tabId = sender.tab ? sender.tab.id : null;
        const frameId = sender.frameId || 0;
        const source = (sender.tab && sender.tab.url) || msg.source || null;
        const token = msg.token || 't' + ++tokenSeq;
        sendResponse({ ack: true, token });
        let res;
        try {
          res = await startYouTubeDownload(msg.videoId, msg.quality || 'v720', source, tabId, frameId);
        } catch (e) {
          res = { ok: false, error: (e && e.message) || String(e) };
        }
        dispatchResult({ type: 'mbd:download-result', token, ...res }, tabId, frameId);
      } else if (msg.type === 'mbd:stats') {
        const tabId = sender.tab ? sender.tab.id : null;
        if (tabId != null) {
          const text = msg.count > 0 ? String(Math.min(msg.count, 99)) : '';
          await chrome.action.setBadgeText({ tabId, text });
          await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'mbd:history') {
        const s = await chrome.storage.local.get('mbdHistory');
        sendResponse({ ok: true, history: Array.isArray(s.mbdHistory) ? s.mbdHistory : [] });
      } else if (msg.type === 'mbd:clearHistory') {
        await chrome.storage.local.remove('mbdHistory');
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();
  return true; // پاسخ آسنکرون
});

/* ---------------- نشانگر تب ---------------- */

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.action.setBadgeText({ tabId, text: '' });
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});
