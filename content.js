/* Runs on Labelbox pages. It never reads your labels or images: it only notices
   which buttons you click (by their name) and whether you are using the page. */
(() => {
  if (window.__uwsContent) return; window.__uwsContent = true;
  const DEFAULTS = { startLabel: ['start labeling', 'start labelling', 'label data', 'start annotating'], startReview: ['start reviewing', 'start review', 'review data'], submitLabel: ['submit'], submitReview: ['approve', 'reject', 'submit review'], idleMinutes: 5 };
  let cfg = DEFAULTS; let lastInput = Date.now(); const lastClick = new WeakMap();
  const send = msg => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch (e) { /* extension reloaded */ } };
  const loadCfg = () => { try { chrome.storage.local.get('detection', r => { if (r && r.detection) cfg = { ...DEFAULTS, ...r.detection }; }); } catch (e) { } };
  loadCfg(); try { chrome.storage.onChanged.addListener(ch => { if (ch.detection) loadCfg(); }); } catch (e) { }

  for (const ev of ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart', 'pointerdown']) addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });

  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const nameOf = el => norm(el.getAttribute('aria-label') || el.innerText || el.textContent || el.value || el.title);
  /** "Submit", "Submit (E)", "Submit ⏎" all count as "submit"; "Submit review" is matched before plain "submit". */
  const matches = (name, list) => list.some(p => name === p || name.startsWith(p + ' ') || name.startsWith(p + '(') || name.startsWith(p + ' ('));

  /** Works out what a click means. Exposed for testing. */
  function classify(name) {
    if (!name || name.length > 60) return null;
    if (matches(name, cfg.startReview)) return { type: 'start', task: 'REVIEW' };
    if (matches(name, cfg.startLabel)) return { type: 'start', task: 'LABEL' };
    if (matches(name, cfg.submitReview)) return { type: 'item', task: 'REVIEW' };
    if (matches(name, cfg.submitLabel)) return { type: 'item', task: 'LABEL' };
    return null;
  }
  window.__uwsClassify = classify;

  addEventListener('click', e => {
    const el = e.target && e.target.closest && e.target.closest('button, [role="button"], a, input[type="submit"], input[type="button"]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const what = classify(nameOf(el)); if (!what) return;
    if (what.type === 'item') { const t = Date.now(); if (t - (lastClick.get(el) || 0) < 700) return; lastClick.set(el, t); } // a double-click on the same button counts once
    send({ ...what, url: location.origin + location.pathname });
  }, true);

  // every 15 s: is the person working in this tab right now?
  const tick = () => send({ type: 'tick', active: document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastInput < (cfg.idleMinutes || 5) * 60000, url: location.origin + location.pathname });
  setInterval(tick, 15000); tick();
})();
