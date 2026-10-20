/* Tab Cover: settings page. */
(function () {
  'use strict';
  var TC = self.TC;
  var S = null, L = null, addType = 'domain', newRuleId = null, platformOK = null, regBusy = false, pinNote = '', regNote = '';
  var TRASH = '<svg class="sg-icon sg-icon--16" aria-hidden="true" viewBox="0 0 32 32"><path d="M12 12H14V24H12zM18 12H20V24H18z"/><path d="M4 6V8H6V28a2 2 0 002 2H24a2 2 0 002-2V8h2V6zM8 28V8H24V28zM12 2H20V4H12z"/></svg>';
  var CHECK_SM = '<svg class="sg-toggle__check" aria-hidden="true" viewBox="0 0 6 5"><path d="M2.2 2.7L5 0 6 1 2.2 5 0 2.7 1 1.5z"/></svg>';
  var HELP = {
    domain: 'Hides every page on this site and its subdomains. Example: instagram.com',
    exact: 'Hides this one address only. Example: mail.example.com/finance'
  };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setSync(o) { return chrome.storage.sync.set(o); }
  function switcher(attr, list, val) {
    return list.map(function (o) { return '<button class="switcher-btn" type="button" data-' + attr + '="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(val)) + '">' + esc(o[1]) + '</button>'; }).join('');
  }
  function toggle(key, label, on, sm, hideLabel) {
    var id = 'tg-' + key.replace(/[^a-z0-9]/gi, '-');
    return '<div class="sg-toggle' + (sm ? ' sg-toggle--sm' : '') + '"><span class="sg-toggle__label-text' + (hideLabel ? ' vh' : '') + '" id="' + id + '">' + esc(label) + '</span>' +
      '<button class="sg-toggle__button" type="button" role="switch" aria-checked="' + on + '" aria-labelledby="' + id + '" data-toggle="' + key + '"><span class="sg-toggle__switch">' + (sm ? CHECK_SM : '') + '</span><span class="sg-toggle__text" aria-hidden="true">' + (on ? 'On' : 'Off') + '</span></button></div>';
  }
  function tag(type) { return '<span class="sg-tag sg-tag--' + (type === 'exact' ? 'purple' : 'blue') + '"><span class="sg-tag__label">' + TC.TYPE_LABEL[type] + '</span></span>'; }

  /* ---------- Render ---------- */
  function renderAddForm(err) {
    $('matchSw').innerHTML = switcher('match', [['domain', 'Domain'], ['exact', 'Exact URL']], addType);
    $('addIn').placeholder = addType === 'domain' ? 'instagram.com' : 'mail.example.com/finance';
    var msg = $('addMsg');
    msg.className = err ? 'sg-form-req' : 'sg-helper';
    msg.textContent = err || HELP[addType];
    $('addIn').classList.toggle('is-invalid', !!err);
    $('addIn').setAttribute('aria-invalid', err ? 'true' : 'false');
  }
  function renderRules() {
    if (!S.rules.length) { $('rules').innerHTML = '<div class="empty">No rules yet. Add an address above and every tab that matches it gets hidden.</div>'; return; }
    $('rules').innerHTML = '<div class="sg-table-container" data-sg-layer="1"><table class="sg-table sg-table--lg"><thead><tr><th>On</th><th>Address</th><th>Match</th><th>Added</th><th><span class="vh">Delete</span></th></tr></thead><tbody>' +
      S.rules.map(function (r) {
        return '<tr class="' + (r.on ? '' : 'is-off') + (r.id === newRuleId ? ' is-new' : '') + '"><td>' + toggle('rule:' + r.id, 'Rule ' + r.pattern, r.on, true, true) + '</td>' +
          '<td class="pattern">' + esc(r.pattern) + '</td><td>' + tag(r.type) + '</td><td>' + esc(r.added || '') + '</td>' +
          '<td class="td-actions"><button class="row-btn" type="button" data-del="' + r.id + '" aria-label="Delete rule ' + esc(r.pattern) + '">' + TRASH + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    newRuleId = null;
  }
  function pinForm(label, help) {
    var set = !!L.pinHash;
    return '<form class="sg-form-item" id="pinForm" autocomplete="off"><label class="sg-label" for="pinIn">' + label + '</label>' +
      '<div class="joined joined--narrow"><input class="sg-input" id="pinIn" type="password" inputmode="numeric" maxlength="6" placeholder="' + (set ? 'Enter a new PIN' : '4 to 6 digits') + '" aria-describedby="pinMsg">' +
      '<button class="sg-btn sg-btn--primary sg-btn--md" type="submit">' + (set ? 'Change PIN' : 'Save PIN') + '</button></div>' +
      (pinNote ? '<p class="' + (pinNote.ok ? 'ok-note' : 'sg-form-req') + '" id="pinMsg">' + esc(pinNote.text) + '</p>' : '<p class="sg-helper" id="pinMsg">' + help + '</p>') +
      '</form>';
  }
  function renderMethod() {
    $('methodSw').innerHTML = switcher('method', [['touch', 'Touch ID'], ['pin', 'PIN'], ['hold', 'Press and hold'], ['shortcut', 'Keyboard shortcut']], S.method);
    $('againSw').innerHTML = switcher('again', [['once', 'This time'], ['15', '15 minutes'], ['session', 'Until restart']], S.again);
    var html = '';
    if (S.method === 'touch') {
      var ready = !!L.credId;
      var note = regNote ? '<p class="' + (regNote.ok ? 'ok-note' : 'sg-form-req') + '">' + esc(regNote.text) + '</p>' : '';
      html = '<div class="field-group"><span class="sg-label">Fingerprint</span>' +
        '<div class="reg" data-sg-layer="1"><span class="reg__fp" id="regFp">' + TC.fingerprintSVG('fp-svg') + '</span>' +
        (ready
          ? '<div class="reg__txt"><b>Ready on this Mac</b><span>Any finger enrolled in Touch ID works. Set up ' + esc(L.credAdded || '') + '.</span></div><button class="sg-btn sg-btn--danger-ghost sg-btn--sm" type="button" data-act="unregister">Remove</button>'
          : '<div class="reg__txt"><b>Not set up</b><span>' + (platformOK === false ? 'Touch ID is not available on this computer.' : 'Touch the sensor once to set it up.') + '</span></div><button class="sg-btn sg-btn--primary sg-btn--sm" type="button" data-act="register"' + (platformOK === false || regBusy ? ' disabled' : '') + '>Set up Touch ID</button>') +
        '</div>' + note + '</div>' +
        pinForm('Backup PIN', 'For when Touch ID is not available, like with the lid closed.');
    } else if (S.method === 'pin') {
      html = pinForm('PIN', '4 to 6 digits. Asked for every time you unlock.');
    } else if (S.method === 'hold') {
      html = '<div class="field-group"><span class="sg-label">Hold for</span><div class="switcher" role="group" aria-label="Hold for">' + switcher('hold', [[1, '1 second'], [2, '2 seconds'], [3, '3 seconds']], S.holdSecs) + '</div></div>';
    } else {
      html = '<div class="field-group"><span class="sg-label">Shortcut</span><div class="keys" id="keys">Loading</div>' +
        '<button class="sg-btn sg-btn--ghost sg-btn--sm" type="button" data-act="shortcuts">Change shortcut</button></div>';
    }
    $('methodExtra').innerHTML = html;
    if (S.method === 'shortcut') showKeys();
  }
  async function showKeys() {
    var cmds = await chrome.commands.getAll();
    var c = cmds.find(function (x) { return x.name === 'unlock-shortcut'; });
    var label = c && c.shortcut;
    var el = $('keys'); if (!el) return;
    if (!label) { el.textContent = 'No shortcut set.'; return; }
    var names = { '⌥': 'Option', '⇧': 'Shift', '⌘': 'Command', '⌃': 'Control' };
    var parts = label.indexOf('+') !== -1 ? label.split('+') : Array.from(label);
    el.innerHTML = parts.map(function (p) { return '<kbd>' + esc(names[p] || p) + '</kbd>'; }).join('+');
  }
  function renderCover() {
    $('coverOpts').innerHTML =
      toggle('rename', 'Rename hidden tabs to Hidden tab', S.rename) +
      toggle('pause', 'Pause sound and video on hidden tabs', S.pause) +
      '<div class="field-group"><span class="sg-label">Cover colour</span><div class="switcher" role="group" aria-label="Cover colour">' + switcher('ctheme', [['g100', 'Dark'], ['white', 'Light']], S.coverTheme) + '</div></div>';
  }
  function renderAll() { renderAddForm(); renderRules(); renderMethod(); renderCover(); }

  /* ---------- Actions ---------- */
  async function addRule() {
    var raw = $('addIn').value;
    if (!raw.trim()) { renderAddForm('Enter an address.'); $('addIn').focus(); return; }
    var p = TC.cleanPattern(raw, addType);
    if (!p) { renderAddForm('That does not look like a web address.'); $('addIn').focus(); return; }
    if (S.rules.some(function (r) { return r.type === addType && r.pattern === p; })) { renderAddForm('That rule is already on your list.'); $('addIn').focus(); return; }
    var id = Date.now();
    newRuleId = id;
    S.rules.unshift({ id: id, pattern: p, type: addType, on: true, added: TC.todayLabel() });
    $('addIn').value = '';
    renderAddForm();
    await setSync({ rules: S.rules });
  }
  async function savePin() {
    var v = $('pinIn').value.trim();
    if (!/^\d{4,6}$/.test(v)) { pinNote = { ok: false, text: 'Use 4 to 6 digits.' }; renderMethod(); $('pinIn').focus(); return; }
    var salt = TC.b64urlFromBuf(TC.randomBytes(16));
    var hash = await TC.hashPin(v, salt);
    await chrome.storage.local.set({ pinHash: hash, pinSalt: salt });
    pinNote = { ok: true, text: 'PIN saved.' };
  }
  async function register() {
    regBusy = true; regNote = '';
    var box = $('regFp');
    if (box) { TC.shuffleScan(box); box.classList.add('is-scanning'); }
    try {
      var cred = await navigator.credentials.create({
        publicKey: {
          challenge: TC.randomBytes(32),
          rp: { name: 'Tab Cover' },
          user: { id: TC.randomBytes(16), name: 'Tab Cover', displayName: 'Tab Cover' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          attestation: 'none',
          timeout: 60000
        }
      });
      await chrome.storage.local.set({ credId: TC.b64urlFromBuf(cred.rawId), credAdded: TC.todayLabel() });
      regNote = { ok: true, text: 'Touch ID is ready.' };
    } catch (e) {
      regNote = { ok: false, text: e && e.name === 'NotAllowedError' ? 'Set up was cancelled. Try again.' : 'Touch ID could not be set up on this computer.' };
      renderMethod();
    }
    regBusy = false;
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var d = b.dataset;
    if (d.match) { addType = d.match; renderAddForm(); $('addIn').focus(); return; }
    if (d.method) { pinNote = ''; regNote = ''; await setSync({ method: d.method }); return; }
    if (d.again) { await setSync({ again: d.again }); return; }
    if (d.hold) { await setSync({ holdSecs: +d.hold }); return; }
    if (d.ctheme) { await setSync({ coverTheme: d.ctheme }); return; }
    if (d.del) { S.rules = S.rules.filter(function (r) { return String(r.id) !== d.del; }); await setSync({ rules: S.rules }); return; }
    if (d.toggle) {
      if (d.toggle.indexOf('rule:') === 0) {
        var id = d.toggle.slice(5);
        S.rules.forEach(function (r) { if (String(r.id) === id) r.on = !r.on; });
        await setSync({ rules: S.rules });
      } else { var o = {}; o[d.toggle] = !S[d.toggle]; await setSync(o); }
      return;
    }
    switch (d.act) {
      case 'register': register(); break;
      case 'unregister': regNote = ''; await chrome.storage.local.set({ credId: '', credAdded: '' }); break;
      case 'shortcuts': chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); break;
    }
  });
  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'addForm') addRule();
    if (e.target.id === 'pinForm') savePin();
  });
  $('addIn').addEventListener('input', function () { if ($('addIn').classList.contains('is-invalid')) renderAddForm(); });
  chrome.storage.onChanged.addListener(async function () { await load(); renderRules(); renderMethod(); renderCover(); });

  async function load() {
    S = await chrome.storage.sync.get(TC.SYNC_DEFAULTS);
    L = await chrome.storage.local.get(TC.LOCAL_DEFAULTS);
  }
  (async function init() {
    try { platformOK = window.PublicKeyCredential && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : false; } catch (e) { platformOK = false; }
    await load();
    renderAll();
  })();
})();
