/* Tab Cover: the small Touch ID window. Asks macOS for Touch ID through WebAuthn, then tells the hidden tab. */
(function () {
  'use strict';
  var TC = self.TC;
  var q = new URLSearchParams(location.search);
  var tabId = +q.get('tab'), returnWin = q.get('win');
  var fp = document.getElementById('fp'), hint = document.getElementById('hint'), err = document.getElementById('err');
  var retry = document.getElementById('retry'), cancel = document.getElementById('cancel');
  var winId = null, running = false, finished = false;
  fp.innerHTML = TC.fingerprintSVG('fp-svg');
  chrome.windows.getCurrent().then(function (w) { winId = w.id; });

  function report(ok, reason) {
    finished = true;
    return chrome.runtime.sendMessage({ type: 'verifyDone', ok: ok, reason: reason, tabId: tabId, winId: winId, returnWin: returnWin });
  }
  function scanning() {
    err.hidden = true; retry.hidden = true;
    fp.classList.remove('is-ok');
    TC.shuffleScan(fp);
    fp.classList.add('is-scanning');
    hint.textContent = 'Place your finger on Touch ID';
  }
  function failed(text) {
    running = false;
    fp.classList.remove('is-scanning', 'is-ok');
    hint.textContent = 'Unlock with Touch ID';
    err.textContent = text; err.hidden = false;
    retry.hidden = false;
    retry.focus();
  }

  async function run() {
    if (running || finished) return;
    running = true;
    scanning();
    var loc = await chrome.storage.local.get(TC.LOCAL_DEFAULTS);
    if (!loc.credId) { failed('Touch ID is not set up yet. Use your PIN, or set it up in settings.'); retry.hidden = true; return; }
    try {
      var cred = await navigator.credentials.get({
        publicKey: {
          challenge: TC.randomBytes(32),
          allowCredentials: [{ type: 'public-key', id: TC.bufFromB64url(loc.credId) }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      var flags = new Uint8Array(cred.response.authenticatorData)[32];
      var verified = (flags & 0x04) !== 0; // UV bit: the fingerprint (or Mac password) was checked
      if (!verified || TC.b64urlFromBuf(cred.rawId) !== loc.credId) { failed('That did not work. Try again.'); return; }
      fp.classList.add('is-ok');
      hint.textContent = 'Unlocked';
      await report(true);
      setTimeout(function () { window.close(); }, 350);
    } catch (e) {
      if (e && e.name === 'NotAllowedError') failed('Touch ID was cancelled or timed out.');
      else failed('Touch ID is not available right now.');
    }
  }

  retry.addEventListener('click', run);
  cancel.addEventListener('click', function () { report(false, 'cancelled').finally(function () { window.close(); }); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancel.click(); });
  window.addEventListener('focus', function () { if (!running && !finished && retry.hidden && err.hidden) run(); });
  if (document.hasFocus()) run(); else setTimeout(run, 150);
})();
