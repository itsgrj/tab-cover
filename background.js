/* Tab Cover: service worker. Holds unlock state per tab, checks the PIN, opens the Touch ID window. */
importScripts('shared.js');

var FIFTEEN_MIN = 15 * 60 * 1000;
var PIN_MAX_TRIES = 5;
var PIN_LOCK_MS = 30 * 1000;

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

/* ---------- Unlock state, kept in session storage so it clears when the browser restarts ---------- */
function key(tabId) { return 'unlock:' + tabId; }
async function grant(tabId) {
  var s = await chrome.storage.sync.get(TC.SYNC_DEFAULTS);
  if (s.again === 'once') return; // "This time" lives in the page only and ends when you leave the tab
  var entry = { mode: s.again, until: s.again === '15' ? Date.now() + FIFTEEN_MIN : 0 };
  var o = {}; o[key(tabId)] = entry;
  await chrome.storage.session.set(o);
}
async function state(tabId) {
  var o = await chrome.storage.session.get(key(tabId));
  var e = o[key(tabId)];
  if (!e) return { unlocked: false };
  if (e.mode === '15' && Date.now() >= e.until) { await chrome.storage.session.remove(key(tabId)); return { unlocked: false }; }
  return { unlocked: true, mode: e.mode, until: e.until };
}
async function revoke(tabId) { await chrome.storage.session.remove(key(tabId)); }
chrome.tabs.onRemoved.addListener(function (tabId) { revoke(tabId); });

/* ---------- PIN ---------- */
async function checkPin(pin) {
  var loc = await chrome.storage.local.get(TC.LOCAL_DEFAULTS);
  if (!loc.pinHash) return { ok: false, reason: 'nopin' };
  var t = (await chrome.storage.session.get('pinTries')).pinTries || { n: 0, lockedUntil: 0 };
  if (Date.now() < t.lockedUntil) return { ok: false, reason: 'locked', wait: Math.ceil((t.lockedUntil - Date.now()) / 1000) };
  var h = await TC.hashPin(String(pin || ''), loc.pinSalt);
  if (h === loc.pinHash) { await chrome.storage.session.set({ pinTries: { n: 0, lockedUntil: 0 } }); return { ok: true }; }
  t.n += 1;
  if (t.n >= PIN_MAX_TRIES) { t = { n: 0, lockedUntil: Date.now() + PIN_LOCK_MS }; }
  await chrome.storage.session.set({ pinTries: t });
  return { ok: false, reason: t.lockedUntil ? 'locked' : 'wrong', wait: t.lockedUntil ? PIN_LOCK_MS / 1000 : 0 };
}

/* ---------- Touch ID window ---------- */
var VERIFY_W = 380, VERIFY_H = 440;
async function openVerify(tabId, windowId) {
  var left, top;
  try {
    var w = await chrome.windows.get(windowId);
    left = Math.round(w.left + (w.width - VERIFY_W) / 2);
    top = Math.round(w.top + Math.min(160, (w.height - VERIFY_H) / 2));
  } catch (e) {}
  var win = await chrome.windows.create({
    url: chrome.runtime.getURL('ui/verify.html?tab=' + tabId + '&win=' + windowId),
    type: 'popup', width: VERIFY_W, height: VERIFY_H, left: left, top: top, focused: true
  });
  var o = {}; o['verify:' + win.id] = { tabId: tabId, done: false };
  await chrome.storage.session.set(o);
}
chrome.windows.onRemoved.addListener(async function (winId) {
  var k = 'verify:' + winId;
  var o = await chrome.storage.session.get(k);
  if (!o[k]) return;
  await chrome.storage.session.remove(k);
  if (!o[k].done) chrome.tabs.sendMessage(o[k].tabId, { type: 'verifyFailed', reason: 'cancelled' }).catch(function () {});
});

/* ---------- Messages ---------- */
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  var tabId = sender.tab ? sender.tab.id : msg.tabId;
  (async function () {
    switch (msg && msg.type) {
      case 'state': {
        var st = await state(tabId);
        try { var cmds = await chrome.commands.getAll(); var c = cmds.find(function (x) { return x.name === 'unlock-shortcut'; }); st.shortcut = c ? c.shortcut : ''; } catch (e) {}
        return st;
      }
      case 'grant': await grant(tabId); return { ok: true };
      case 'revoke': await revoke(tabId); return { ok: true };
      case 'checkPin': {
        var r = await checkPin(msg.pin);
        if (r.ok) await grant(tabId);
        return r;
      }
      case 'touch': await openVerify(tabId, sender.tab.windowId); return { ok: true };
      case 'verifyDone': {
        // From the Touch ID window: mark it done so closing it does not count as a cancel.
        var k = 'verify:' + msg.winId, o = await chrome.storage.session.get(k);
        if (o[k]) { o[k].done = true; await chrome.storage.session.set(o); }
        if (msg.ok) { await grant(msg.tabId); }
        chrome.tabs.sendMessage(msg.tabId, msg.ok ? { type: 'unlocked' } : { type: 'verifyFailed', reason: msg.reason || 'failed' }).catch(function () {});
        if (msg.ok && msg.returnWin) chrome.windows.update(+msg.returnWin, { focused: true }).catch(function () {});
        return { ok: true };
      }
      case 'openOptions': chrome.runtime.openOptionsPage(); return { ok: true };
      default: return { ok: false };
    }
  })().then(reply, function (e) { reply({ ok: false, error: String(e) }); });
  return true;
});

/* ---------- Keyboard shortcut ---------- */
chrome.commands.onCommand.addListener(async function (command) {
  if (command !== 'unlock-shortcut') return;
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'shortcut' }).catch(function () {});
});
