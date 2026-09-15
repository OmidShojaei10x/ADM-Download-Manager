/* MediaCatch — options page */
'use strict';

const DEFAULTS = { enabled: true, hoverButton: true, minImageSize: 64, saveAs: false, blocked: [] };
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  const s = await chrome.storage.local.get('mbdSettings');
  const cfg = { ...DEFAULTS, ...(s.mbdSettings || {}) };

  $('f-enabled').checked = cfg.enabled !== false;
  $('f-hover').checked = cfg.hoverButton !== false;
  $('f-saveas').checked = !!cfg.saveAs;
  $('f-min').value = String(cfg.minImageSize);
  $('f-min-val').textContent = String(cfg.minImageSize);
  $('f-blocked').value = (cfg.blocked || []).join('\n');

  $('f-min').addEventListener('input', () => {
    $('f-min-val').textContent = $('f-min').value;
  });

  $('save').addEventListener('click', async () => {
    const val = {
      enabled: $('f-enabled').checked,
      hoverButton: $('f-hover').checked,
      saveAs: $('f-saveas').checked,
      minImageSize: parseInt($('f-min').value, 10) || 0,
      blocked: $('f-blocked')
        .value.split('\n')
        .map((t) => t.trim())
        .filter(Boolean),
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
