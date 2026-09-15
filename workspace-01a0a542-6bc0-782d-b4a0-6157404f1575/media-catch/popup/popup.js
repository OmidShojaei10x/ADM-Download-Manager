/* MediaCatch — popup */
'use strict';

const TYPE_ICON = { image: '🖼️', audio: '🎵', video: '🎬', stream: '📡' };
const TYPE_LABEL = { image: 'تصویر', audio: 'صوت', video: 'ویدیو', stream: 'استریم' };
const DEFAULTS = { enabled: true, hoverButton: true, minImageSize: 64, saveAs: false, blocked: [] };

let tab = null;

const $ = (id) => document.getElementById(id);

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

async function patchSettings(patch) {
  const s = await chrome.storage.local.get('mbdSettings');
  await chrome.storage.local.set({
    mbdSettings: { ...DEFAULTS, ...(s.mbdSettings || {}), ...patch },
  });
}

async function refreshPage() {
  const list = $('page-list');
  list.innerHTML = '';
  const empty = $('page-empty');
  const pill = $('count-pill');

  let data = null;
  if (tab && tab.id != null) {
    try {
      data = await chrome.tabs.sendMessage(tab.id, { type: 'mbd:ping' });
    } catch (e) {}
  }

  if (!data || !data.ok) {
    empty.textContent = 'در این صفحه اسکریپت افزونه اجرا نمی‌شود (مثلاً صفحات داخلی کروم).';
    empty.classList.remove('hidden');
    pill.textContent = '—';
    return;
  }

  empty.classList.add('hidden');
  pill.textContent = String(data.count);
  const items = (data.items || []).slice(0, 10);
  if (!items.length) {
    empty.textContent = 'هنوز رسانه‌ای پیدا نشده؛ چند ثانیه صبر کنید یا ↻ را بزنید.';
    empty.classList.remove('hidden');
    return;
  }

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'item';
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.textContent = TYPE_ICON[it.type] || '📎';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.name;
    nm.title = it.url;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = (TYPE_LABEL[it.type] || it.type) + (it.w && it.h ? ' · ' + it.w + '×' + it.h : '');
    meta.append(nm, sub);
    const btn = document.createElement('button');
    btn.className = 'dl';
    btn.textContent = '⬇ دانلود';
    btn.addEventListener('click', async () => {
      const ok = await popupDownload(it);
      if (ok) {
        btn.classList.add('done');
        btn.textContent = '✓ شروع شد';
        setTimeout(() => {
          btn.classList.remove('done');
          btn.textContent = '⬇ دانلود';
        }, 2500);
      } else {
        btn.classList.add('err');
        btn.textContent = 'خطا';
        setTimeout(() => {
          btn.classList.remove('err');
          btn.textContent = '⬇ دانلود';
        }, 2500);
      }
    });
    row.append(ic, meta, btn);
    list.appendChild(row);
  }
}

// دانلود از popup: اول از طریق content script (زنجیره کامل)، بعد مستقیم از background
async function popupDownload(it) {
  // ۱) content script خودش fallback داخلی هم دارد
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'mbd:downloadItem', url: it.url });
    if (r && r.ok) return true;
  } catch (e) {}
  // ۲) مستقیم از background (پروتکل ack + result)
  return await new Promise((resolve) => {
    let done = false;
    const PToken = 'popup-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      chrome.runtime.onMessage.removeListener(h);
      resolve(ok);
    };
    const t = setTimeout(() => finish(false), 30000);
    const h = (msg) => {
      if (msg && msg.type === 'mbd:download-result' && msg.token === PToken) finish(!!msg.ok);
    };
    chrome.runtime.onMessage.addListener(h);
    try {
      chrome.runtime.sendMessage({ type: 'mbd:download', token: PToken, url: it.url, filename: it.name, source: location.href });
    } catch (e) {
      finish(false);
    }
  });
}

async function refreshHistory() {
  const list = $('history-list');
  list.innerHTML = '';
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'mbd:history' });
  } catch (e) {
    r = null;
  }
  const h = (r && r.history) || [];
  if (!h.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'هنوز دانلودی ثبت نشده.';
    list.appendChild(d);
    return;
  }
  const ST = {
    in_progress: ['⏳', 'در حال دانلود'],
    complete: ['✅', 'تکمیل شد'],
    interrupted: ['⚠️', 'قطع شد'],
  };
  for (const it of h.slice(0, 8)) {
    const [ic, label] = ST[it.state] || ['❔', it.state];
    const row = document.createElement('div');
    row.className = 'hrow';
    row.title = it.url;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = ic;
    st.title = label + (it.error ? ' — ' + it.error : '');
    const fn = document.createElement('span');
    fn.className = 'fn';
    fn.textContent = it.filename || it.url;
    const sz = document.createElement('span');
    sz.className = 'sz';
    sz.textContent = [fmtTime(it.startedAt), fmtSize(it.size)].filter(Boolean).join(' · ');
    row.append(st, fn, sz);
    list.appendChild(row);
  }
}

async function main() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = tabs[0];

  const s = await chrome.storage.local.get('mbdSettings');
  const cfg = s.mbdSettings || {};
  $('q-enabled').checked = cfg.enabled !== false;
  $('q-saveas').checked = !!cfg.saveAs;
  $('q-enabled').addEventListener('change', (e) => patchSettings({ enabled: e.target.checked }));
  $('q-saveas').addEventListener('change', (e) => patchSettings({ saveAs: e.target.checked }));

  $('btn-rescan').addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'mbd:rescan' });
    } catch (e) {}
    setTimeout(refreshPage, 600);
  });
  $('btn-panel').addEventListener('click', () => {
    try {
      chrome.tabs.sendMessage(tab.id, { type: 'mbd:togglePanel' });
    } catch (e) {}
  });
  $('btn-clear').addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'mbd:clearHistory' });
    } catch (e) {}
    refreshHistory();
  });
  $('btn-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await refreshPage();
  await refreshHistory();
}

main();
