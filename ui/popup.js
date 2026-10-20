/* Tab Cover: toolbar popup. */
(function () {
  'use strict';
  var TC = self.TC;
  var S = null, tab = null, info = null;
  var CHECK_SM = '<svg class="sg-toggle__check" aria-hidden="true" viewBox="0 0 6 5"><path d="M2.2 2.7L5 0 6 1 2.2 5 0 2.7 1 1.5z"/></svg>';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function btn(kind, act, label) { return '<button class="sg-btn sg-btn--' + kind + ' sg-btn--md" type="button" data-act="' + act + '">' + label + '</button>'; }

  async function refresh() {
    S = await chrome.storage.sync.get(TC.SYNC_DEFAULTS);
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
    info = null;
    if (tab && TC.isWebUrl(tab.url)) {
      try { info = await chrome.tabs.sendMessage(tab.id, { type: 'status' }); } catch (e) { info = null; }
    }
    render();
  }
  function render() {
    var url = tab && tab.url, web = TC.isWebUrl(url), rule = web ? TC.matchRule(S.rules, url) : null, actions = '', status;
    if (!web) status = 'There is nothing to hide on this page.';
    else if (S.paused) status = rule ? 'Hiding is paused.' : '<span class="mono">' + esc(TC.hostOf(url)) + '</span> is not on your list.';
    else if (rule && info && info.covered) { status = 'Hidden. Unlock it on the page.'; }
    else if (rule) { status = 'Visible for now.'; actions = btn('secondary', 'hideNow', 'Hide now') + btn('ghost', 'stop', 'Stop hiding this site'); }
    else {
      status = '<span class="mono">' + esc(TC.hostOf(url)) + '</span> is not on your list.';
      actions = btn('primary', 'addDomain', 'Hide this site') + btn('ghost', 'addExact', 'Hide only this page');
    }
    if (web && !info && !S.paused) status += ' Reload the page if it was open before Tab Cover was installed.';
    $('status').innerHTML = status;
    $('actions').innerHTML = actions;
    $('actions').hidden = !actions;
    $('pauseBox').innerHTML = '<div class="sg-toggle sg-toggle--sm"><span class="sg-toggle__label-text" id="pl">Pause all hiding</span><button class="sg-toggle__button" type="button" role="switch" aria-checked="' + S.paused + '" aria-labelledby="pl" data-act="pause"><span class="sg-toggle__switch">' + CHECK_SM + '</span><span class="sg-toggle__text" aria-hidden="true">' + (S.paused ? 'On' : 'Off') + '</span></button></div>';
  }
  async function addRule(type) {
    var p = TC.cleanPattern(tab.url, type);
    if (!p) return;
    if (!S.rules.some(function (r) { return r.type === type && r.pattern === p; })) {
      S.rules.unshift({ id: Date.now(), pattern: p, type: type, on: true, added: TC.todayLabel() });
    } else { S.rules.forEach(function (r) { if (r.type === type && r.pattern === p) r.on = true; }); }
    await chrome.storage.sync.set({ rules: S.rules });
    window.close();
  }
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'settings') { chrome.runtime.openOptionsPage(); window.close(); return; }
    switch (b.dataset.act) {
      case 'addDomain': addRule('domain'); break;
      case 'addExact': addRule('exact'); break;
      case 'stop': {
        var r = TC.matchRule(S.rules, tab.url);
        S.rules.forEach(function (x) { if (r && x.id === r.id) x.on = false; });
        await chrome.storage.sync.set({ rules: S.rules }); refresh(); break;
      }
      case 'hideNow': try { await chrome.tabs.sendMessage(tab.id, { type: 'hideNow' }); } catch (x) {} window.close(); break;
      case 'pause': await chrome.storage.sync.set({ paused: !S.paused }); refresh(); break;
    }
  });
  refresh();
})();
