/* Tab Cover: content script. Decides whether this tab matches a rule and, if so, puts the cover over it. */
(function () {
  'use strict';
  if (window.top !== window || window.__tabCoverLoaded) return;
  window.__tabCoverLoaded = true;

  var TC = self.TC;
  var HIDDEN_TITLE = 'Hidden tab';
  var FADE_MS = 260, TOAST_MS = 6000, SCAN_MS = 1300, SCAN_HOLD_MS = 450;

  var S = null;                 // synced settings
  var has = { touch: false, pin: false };
  var shortcutLabel = '';
  var covered = false, rule = null, mode = '';
  var onceUnlocked = false;     // "This time": ends when you leave the tab
  var altPin = false;           // chose "Use PIN" instead of Touch ID
  var verifying = false, scanStart = 0;
  var host = null, root = null, els = {};
  var lastHref = location.href, evalSeq = 0, expiryTimer = 0, toastTimer = 0, teardownTimer = 0, holdTimer = 0, enforceTimer = 0;
  var saved = { title: null, icons: [], icon: null, inert: null, overflow: null, paused: [] };

  /* ---------- Messaging that survives an extension reload ---------- */
  function alive() { try { return !!chrome.runtime && !!chrome.runtime.id; } catch (e) { return false; } }
  function send(msg) {
    if (!alive()) return Promise.resolve({});
    try { return chrome.runtime.sendMessage(msg).then(function (r) { return r || {}; }, function () { return {}; }); }
    catch (e) { return Promise.resolve({}); }
  }

  /* ---------- Settings ---------- */
  async function load() {
    var r = await Promise.all([chrome.storage.sync.get(TC.SYNC_DEFAULTS), chrome.storage.local.get(TC.LOCAL_DEFAULTS)]);
    S = r[0];
    has = { touch: !!r[1].credId, pin: !!r[1].pinHash };
  }

  /* ---------- Decide ---------- */
  async function evaluate() {
    var seq = ++evalSeq;
    if (!S) return;
    var r = S.paused ? null : TC.matchRule(S.rules, location.href);
    if (!r) { onceUnlocked = false; rule = null; if (covered) uncover(false); return; }
    rule = r;
    if (onceUnlocked) { if (covered) uncover(false); return; }
    var st = await send({ type: 'state' });
    if (seq !== evalSeq) return;
    shortcutLabel = st.shortcut || shortcutLabel;
    if (st.unlocked) {
      if (covered) uncover(false);
      clearTimeout(expiryTimer);
      if (st.mode === '15') expiryTimer = setTimeout(evaluate, Math.max(0, st.until - Date.now()) + 50);
      return;
    }
    cover();
  }

  /* ---------- Cover ---------- */
  function build() {
    host = document.createElement('tab-cover-shield');
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>' + self.TC_COVER_CSS + '</style>' +
      '<div class="cover is-off" role="dialog" aria-modal="true" aria-label="Hidden tab">' +
        '<div class="inner"><h1 class="title">Hidden.</h1><div class="slot"></div></div>' +
        '<div class="fallback" hidden></div>' +
      '</div>' +
      '<div class="toast" role="status" hidden></div>';
    els = { cover: root.querySelector('.cover'), slot: root.querySelector('.slot'), fallback: root.querySelector('.fallback'), toast: root.querySelector('.toast') };
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('pointerdown', onPointerDown);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { root.addEventListener(t, holdStop); });
    root.addEventListener('contextmenu', function (e) { if (e.target.closest('[data-act="hold"]')) e.preventDefault(); });
    // Keep keys typed into the cover away from the page's own shortcuts.
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      root.addEventListener(t, function (e) {
        if (t === 'keydown') onKey(e);
        if (t === 'keyup') { var b = e.target.closest && e.target.closest('[data-act="hold"]'); if (b && (e.key === ' ' || e.key === 'Enter')) holdStop(); }
        e.stopPropagation();
      });
    });
    loadFont();
  }
  function attach() {
    if (!host) build();
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
  }
  function teardown() {
    clearTimeout(toastTimer); clearTimeout(teardownTimer);
    if (host && host.isConnected) host.remove();
  }

  var fontLoaded = false;
  async function loadFont() {
    if (fontLoaded) return;
    fontLoaded = true;
    try {
      var buf = await (await fetch(chrome.runtime.getURL('fonts/GeistPixel-Square.woff2'))).arrayBuffer();
      var face = new FontFace('Geist Pixel Square', buf, { weight: '400', style: 'normal' });
      await face.load();
      document.fonts.add(face);
    } catch (e) { /* the cover falls back to the system font */ }
  }

  function pickMode() {
    if (S.method === 'hold') return 'hold';
    if (S.method === 'shortcut') return 'shortcut';
    if (S.method === 'touch') {
      if (has.touch && !(altPin && has.pin)) return 'touch';
      if (has.pin) return 'pin';
      return 'setup';
    }
    return has.pin ? 'pin' : 'setup';
  }
  function isMac() { return /Mac/i.test(navigator.platform || navigator.userAgent); }
  function keysHTML() {
    var label = shortcutLabel || (isMac() ? '⌥⇧H' : 'Alt+Shift+H');
    var parts = label.indexOf('+') !== -1 ? label.split('+') : Array.from(label);
    var names = { '⌥': 'Option', '⇧': 'Shift', '⌘': 'Command', '⌃': 'Control' };
    return parts.map(function (p) { return '<kbd>' + (names[p] || p) + '</kbd>'; }).join('+');
  }
  function render() {
    mode = pickMode();
    var html = '';
    if (mode === 'touch') {
      html = '<button class="fp" type="button" data-act="touch" aria-label="Unlock with Touch ID">' + TC.fingerprintSVG() + '</button>' +
        '<p class="hint" data-hint>Unlock with Touch ID</p><p class="err" data-err hidden></p>';
    } else if (mode === 'pin') {
      html = '<form class="pin" data-form="pin" autocomplete="off"><input type="password" inputmode="numeric" maxlength="6" placeholder="PIN" aria-label="PIN" autocomplete="off" spellcheck="false">' +
        '<button class="btn" type="submit">Unlock</button></form><p class="err" data-err hidden></p>';
    } else if (mode === 'hold') {
      html = '<button class="btn hold hold-' + (S.holdSecs || 2) + '" type="button" data-act="hold">Hold to unlock<span class="hold__bar" aria-hidden="true"></span></button>';
    } else if (mode === 'shortcut') {
      html = '<div class="keys" data-keys>' + keysHTML() + '</div>';
    } else {
      html = '<p class="hint">Set up Touch ID or a PIN to unlock.</p><button class="btn" type="button" data-act="options">Open settings</button>';
    }
    els.slot.innerHTML = html;
    var fb = '';
    if (mode === 'touch' && has.pin) fb = '<span>Touch ID not working?</span><button class="link" type="button" data-act="usePin">Use PIN</button>';
    if (mode === 'pin' && S.method === 'touch' && has.touch) fb = '<span>Sensor back in reach?</span><button class="link" type="button" data-act="useTouch">Use Touch ID</button>';
    els.fallback.innerHTML = fb;
    els.fallback.hidden = !fb;
    els.cover.setAttribute('data-sg-theme', S.coverTheme === 'white' ? 'white' : 'g100');
  }
  function focusMain() {
    // Only the PIN field takes focus on its own; the fingerprint waits for a click.
    var t = els.slot.querySelector('input');
    if (t) try { t.focus({ preventScroll: true }); } catch (e) {}
  }
  function cover() {
    attach();
    clearTimeout(teardownTimer); clearTimeout(toastTimer);
    host.removeAttribute('data-mode');
    els.toast.hidden = true;
    var wasCovered = covered;
    covered = true;
    if (!wasCovered) { altPin = false; verifying = false; render(); }
    els.cover.classList.remove('is-off');
    startEnforce();
    if (!wasCovered) setTimeout(focusMain, 50);
  }
  function uncover(withToast) {
    covered = false;
    verifying = false;
    holdStop();
    stopEnforce();
    if (!host) return;
    els.cover.classList.add('is-off');
    if (withToast) showToast();
    else teardownTimer = setTimeout(function () { if (!covered) teardown(); }, FADE_MS);
  }

  /* ---------- Unlocking ---------- */
  function unlocked() {
    if (S.again === 'once') onceUnlocked = true;
    uncover(true);
  }
  function unlockLocal() {
    // Hold and shortcut are checked in the page; tell the service worker so 15 minutes / until restart can stick.
    send({ type: 'grant' }).then(unlocked);
  }
  function setErr(text) {
    var e = els.slot.querySelector('[data-err]');
    if (!e) return;
    e.textContent = text || '';
    e.hidden = !text;
  }
  function startTouch() {
    if (verifying) return;
    var fp = els.slot.querySelector('.fp');
    if (!fp) return;
    verifying = true;
    scanStart = Date.now();
    setErr('');
    TC.shuffleScan(fp);
    fp.classList.remove('is-ok');
    fp.classList.add('is-scanning');
    var h = els.slot.querySelector('[data-hint]');
    if (h) h.textContent = 'Place your finger on Touch ID';
    send({ type: 'touch' });
  }
  function touchResult(ok, reason) {
    var fp = els.slot && els.slot.querySelector('.fp');
    var h = els.slot && els.slot.querySelector('[data-hint]');
    if (ok) {
      // Let the scan finish filling before it turns green, even when Touch ID answers quickly.
      setTimeout(function () {
        if (fp) fp.classList.add('is-ok');
        if (h) h.textContent = 'Unlocked';
        setTimeout(unlocked, SCAN_HOLD_MS);
      }, Math.max(0, SCAN_MS - (Date.now() - scanStart)));
      return;
    }
    verifying = false;
    if (fp) fp.classList.remove('is-scanning', 'is-ok');
    if (h) h.textContent = 'Unlock with Touch ID';
    if (reason !== 'cancelled') setErr('That did not work. Try again.');
  }
  async function submitPin(form) {
    var input = form.querySelector('input'), btn = form.querySelector('button');
    var pin = input.value;
    if (!pin) { input.focus(); return; }
    btn.disabled = true;
    var r = await send({ type: 'checkPin', pin: pin });
    btn.disabled = false;
    if (r.ok) { unlocked(); return; }
    input.value = '';
    input.classList.add('is-invalid');
    if (r.reason === 'locked') setErr('Too many tries. Wait ' + r.wait + ' seconds.');
    else if (r.reason === 'nopin') setErr('No PIN is set. Set one in settings.');
    else setErr('Wrong PIN');
    input.focus();
  }

  /* Press and hold */
  function holdStart(btn) {
    if (holdTimer) return;
    btn.classList.add('is-holding');
    holdTimer = setTimeout(function () { holdTimer = 0; unlockLocal(); }, (S.holdSecs || 2) * 1000);
  }
  function holdStop() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (root) root.querySelectorAll('.hold.is-holding').forEach(function (b) { b.classList.remove('is-holding'); });
  }
  function shortcutUnlock() {
    if (!covered || mode !== 'shortcut') return;
    var k = els.slot.querySelector('[data-keys]');
    if (k) k.classList.add('is-flash');
    setTimeout(unlockLocal, 200);
  }

  /* ---------- Cover events ---------- */
  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.getAttribute('data-act')) {
      case 'touch': startTouch(); break;
      case 'usePin': altPin = true; render(); focusMain(); break;
      case 'useTouch': altPin = false; render(); focusMain(); break;
      case 'options': send({ type: 'openOptions' }); break;
      case 'hideNow': hideNow(); break;
    }
  }
  function onSubmit(e) {
    e.preventDefault();
    if (e.target.matches('[data-form="pin"]')) submitPin(e.target);
  }
  function onPointerDown(e) {
    var b = e.target.closest('[data-act="hold"]');
    if (!b) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (x) {}
    holdStart(b);
  }
  function onKey(e) {
    var b = e.target.closest && e.target.closest('[data-act="hold"]');
    if (b && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) holdStart(b); }
    var input = e.target.matches && e.target.matches('.pin input');
    if (input && e.target.classList.contains('is-invalid')) { e.target.classList.remove('is-invalid'); setErr(''); }
  }

  /* ---------- Toast ---------- */
  function showToast() {
    var sub = S.again === '15' ? 'Hides again in 15 minutes.' : S.again === 'session' ? 'Until you restart the browser.' : 'Hides again when you leave this tab.';
    els.toast.innerHTML = '<div class="toast__text"><b>Visible</b><span>' + sub + '</span></div><button class="toast__btn" type="button" data-act="hideNow">Hide now</button>';
    clearTimeout(toastTimer); clearTimeout(teardownTimer);
    setTimeout(function () { if (covered) return; host.setAttribute('data-mode', 'toast'); els.toast.hidden = false; }, FADE_MS);
    toastTimer = setTimeout(function () { if (!covered) teardown(); }, FADE_MS + TOAST_MS);
  }
  function hideNow() {
    onceUnlocked = false;
    send({ type: 'revoke' }).then(evaluate);
  }

  /* ---------- What the cover does to the page ---------- */
  function startEnforce() {
    applyPage();
    clearInterval(enforceTimer);
    enforceTimer = setInterval(applyPage, 300);
  }
  function stopEnforce() {
    clearInterval(enforceTimer);
    enforceTimer = 0;
    restorePage();
  }
  function applyPage() {
    if (!covered) return;
    attach();
    var de = document.documentElement;
    if (de && saved.overflow === null) { saved.overflow = de.style.overflow; de.style.overflow = 'hidden'; }
    if (document.body && saved.inert === null) { saved.inert = document.body.inert; document.body.inert = true; }
    if (S.rename) {
      if (document.title !== HIDDEN_TITLE) { saved.title = document.title; document.title = HIDDEN_TITLE; }
      swapIcon();
    }
    if (S.pause) pauseMedia();
  }
  function restorePage() {
    var de = document.documentElement;
    if (de && saved.overflow !== null) { de.style.overflow = saved.overflow; saved.overflow = null; }
    if (document.body && saved.inert !== null) { document.body.inert = saved.inert; saved.inert = null; }
    if (saved.title !== null && document.title === HIDDEN_TITLE) document.title = saved.title;
    saved.title = null;
    if (saved.icon) {
      saved.icon.remove(); saved.icon = null;
      saved.icons.forEach(function (l) { if (document.head) document.head.appendChild(l); });
      saved.icons = [];
    }
  }
  function swapIcon() {
    if (!document.head || (saved.icon && saved.icon.isConnected)) return;
    document.head.querySelectorAll('link[rel~="icon"]').forEach(function (l) { if (l !== saved.icon) { saved.icons.push(l); l.remove(); } });
    var link = document.createElement('link');
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('icons/hidden-32.png');
    document.head.appendChild(link);
    saved.icon = link;
  }
  function pauseMedia() {
    document.querySelectorAll('video, audio').forEach(function (m) { if (!m.paused) { try { m.pause(); } catch (e) {} } });
  }
  document.addEventListener('play', function (e) {
    if (covered && S && S.pause && e.target && typeof e.target.pause === 'function') e.target.pause();
  }, true);

  /* ---------- Keyboard shortcut fallback (when the browser shortcut is not set) ---------- */
  window.addEventListener('keydown', function (e) {
    if (covered && mode === 'shortcut' && e.altKey && e.shiftKey && e.code === 'KeyH') { e.preventDefault(); e.stopPropagation(); shortcutUnlock(); }
  }, true);

  /* ---------- Leaving the tab ends "This time" ---------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && onceUnlocked) { onceUnlocked = false; evaluate(); }
  });

  /* ---------- Address changes in single page apps ---------- */
  function checkHref() { if (location.href !== lastHref) { lastHref = location.href; evaluate(); } }
  setInterval(checkHref, 500);
  window.addEventListener('popstate', checkHref);
  window.addEventListener('hashchange', checkHref);

  /* ---------- Messages ---------- */
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    switch (msg && msg.type) {
      case 'unlocked': if (covered) touchResult(true); break;
      case 'verifyFailed': if (covered) touchResult(false, msg.reason); break;
      case 'shortcut': shortcutUnlock(); break;
      case 'hideNow': hideNow(); break;
      case 'status':
        reply({ href: location.href, covered: covered, rule: rule, unlocked: !!rule && !covered });
        return;
    }
    reply({ ok: true });
  });
  chrome.storage.onChanged.addListener(async function (changes, area) {
    if (area !== 'sync' && area !== 'local') return;
    await load();
    if (covered) { render(); }
    evaluate();
  });

  load().then(evaluate);
})();
