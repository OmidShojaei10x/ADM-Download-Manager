/* MediaCatch — محدوده فعال‌سازی بر اساس دامنه (shared: background + content) */
'use strict';

const MBD_SITE_SCOPE_DEFAULTS = {
  siteMode: 'all',
  allowed: [],
  blocked: [],
};

function mbdNormalizeDomain(d) {
  return String(d).trim().toLowerCase().replace(/^\.+/, '');
}

function mbdHostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function mbdHostMatchesList(host, list) {
  return (list || []).some((entry) => {
    const d = mbdNormalizeDomain(entry);
    if (!d) return false;
    return host === d || host.endsWith('.' + d);
  });
}

/** آیا افزونه روی این URL (معمولاً آدرس تب) باید فعال باشد؟ */
function mbdIsSiteScopeActive(cfg, pageUrl) {
  const c = { ...MBD_SITE_SCOPE_DEFAULTS, ...(cfg || {}) };
  const mode = c.siteMode || 'all';
  const host = mbdHostFromUrl(pageUrl || '');

  if (!host) {
    if (mode === 'allowlist') return false;
    return true;
  }

  if (mode === 'allowlist') {
    const list = c.allowed || [];
    if (!list.length) return false;
    return mbdHostMatchesList(host, list);
  }
  if (mode === 'blocklist') {
    return !mbdHostMatchesList(host, c.blocked || []);
  }
  return true;
}

function mbdParseDomainLines(text) {
  return String(text || '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
}

const mbdSiteScope = {
  MBD_SITE_SCOPE_DEFAULTS,
  mbdIsSiteScopeActive,
  mbdParseDomainLines,
  mbdHostMatchesList,
};

if (typeof globalThis !== 'undefined') {
  globalThis.mbdSiteScope = mbdSiteScope;
}
