/* MediaCatch — options page */
'use strict';

const DEFAULTS = {
  enabled: true,
  hoverButton: true,
  minImageSize: 64,
  saveAs: false,
  siteMode: 'all',
  allowed: [],
  blocked: [],
};
const $ = (id) => document.getElementById(id);

function parseDomains(text) {
  if (typeof mbdSiteScope !== 'undefined' && mbdSiteScope.mbdParseDomainLines) {
    return mbdSiteScope.mbdParseDomainLines(text);
  }
  return String(text || '')
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
}

function syncScopeUi(mode) {
  const m = mode || document.querySelector('input[name="siteMode"]:checked')?.value || 'all';
  $('fields-allow').hidden = m !== 'allowlist';
  $('fields-deny').hidden = m !== 'blocklist';
}

document.addEventListener('DOMContentLoaded', async () => {
  const s = await chrome.storage.local.get('mbdSettings');
  const cfg = { ...DEFAULTS, ...(s.mbdSettings || {}) };

  $('f-enabled').checked = cfg.enabled !== false;
  $('f-hover').checked = cfg.hoverButton !== false;
  $('f-saveas').checked = !!cfg.saveAs;
  $('f-min').value = String(cfg.minImageSize);
  $('f-min-val').textContent = String(cfg.minImageSize);
  $('f-allowed').value = (cfg.allowed || []).join('\n');
  $('f-blocked').value = (cfg.blocked || []).join('\n');

  const mode = cfg.siteMode || 'all';
  const modeEl = document.querySelector(`input[name="siteMode"][value="${mode}"]`);
  if (modeEl) modeEl.checked = true;
  else $('scope-all').checked = true;
  syncScopeUi(mode);

  document.querySelectorAll('input[name="siteMode"]').forEach((el) => {
    el.addEventListener('change', () => syncScopeUi());
  });

  $('f-min').addEventListener('input', () => {
    $('f-min-val').textContent = $('f-min').value;
  });

  $('save').addEventListener('click', async () => {
    const siteMode = document.querySelector('input[name="siteMode"]:checked')?.value || 'all';
    const val = {
      enabled: $('f-enabled').checked,
      hoverButton: $('f-hover').checked,
      saveAs: $('f-saveas').checked,
      minImageSize: parseInt($('f-min').value, 10) || 0,
      siteMode,
      allowed: parseDomains($('f-allowed').value),
      blocked: parseDomains($('f-blocked').value),
    };
    await chrome.storage.local.set({ mbdSettings: val });
    const m = $('saved-msg');
    m.classList.add('show');
    setTimeout(() => m.classList.remove('show'), 2200);
  });

  $('reset').addEventListener('click', async () => {
    await chrome.storage.local.set({ mbdSettings: { ...DEFAULTS } });
    location.reload();
  });
});
