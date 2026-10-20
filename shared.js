/* Tab Cover: logic shared by the service worker, the content script and the extension pages. */
(function (root) {
  'use strict';

  var SYNC_DEFAULTS = {
    rules: [],            // { id, pattern, type: 'domain' | 'exact', on, added }
    method: 'touch',      // 'touch' | 'pin' | 'hold' | 'shortcut'
    again: 'once',        // 'once' | '15' | 'session'
    holdSecs: 2,          // 1 | 2 | 3
    rename: true,
    pause: true,
    coverTheme: 'g100',   // 'g100' | 'white'
    paused: false
  };
  var LOCAL_DEFAULTS = { credId: '', credAdded: '', pinHash: '', pinSalt: '' };
  var TYPE_LABEL = { domain: 'Domain', exact: 'Exact URL' };

  function isWebUrl(u) { return /^https?:\/\//i.test(u || ''); }
  function withProto(u) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : 'https://' + u; }
  function hostOf(u) {
    if (!u) return '';
    try { return new URL(withProto(String(u).trim())).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (e) { return ''; }
  }
  // Exact URL comparison ignores the protocol, a leading www., the #fragment and a trailing slash.
  function normUrl(u) {
    var s = String(u || '').trim();
    try {
      var x = new URL(withProto(s));
      s = x.hostname.replace(/^www\./i, '').toLowerCase() + (x.port ? ':' + x.port : '') + x.pathname + x.search;
    } catch (e) { s = s.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').split('#')[0]; }
    return s.replace(/\/+$/, '');
  }
  function cleanPattern(raw, type) {
    var p = String(raw || '').trim();
    if (!p) return '';
    if (type === 'domain') {
      var h = hostOf(p);
      return h || '';
    }
    return normUrl(p);
  }
  function hits(rule, url) {
    if (!rule || !rule.on || !isWebUrl(url)) return false;
    if (rule.type === 'domain') {
      var h = hostOf(url), d = String(rule.pattern).toLowerCase();
      return h === d || (h.length > d.length && h.slice(-(d.length + 1)) === '.' + d);
    }
    if (rule.type === 'exact') return normUrl(url) === normUrl(rule.pattern);
    return false;
  }
  function matchRule(rules, url) {
    for (var i = 0; i < (rules || []).length; i++) { if (hits(rules[i], url)) return rules[i]; }
    return null;
  }

  // The pixel fingerprint (Option C): 31 x 34 grid, drawn as outlined squares.
  var FP_CELLS = '13,0;14,0;15,0;16,0;17,0;10,1;11,1;12,1;18,1;19,1;20,1;8,2;9,2;14,2;15,2;16,2;21,2;22,2;7,3;11,3;12,3;13,3;23,3;6,4;9,4;10,4;21,4;24,4;5,5;7,5;8,5;11,5;12,5;13,5;14,5;15,5;16,5;17,5;18,5;19,5;22,5;23,5;25,5;4,6;6,6;7,6;10,6;20,6;23,6;24,6;26,6;3,7;6,7;8,7;9,7;12,7;13,7;14,7;15,7;16,7;17,7;18,7;21,7;22,7;24,7;27,7;3,8;5,8;8,8;10,8;11,8;19,8;22,8;23,8;25,8;27,8;2,9;4,9;9,9;10,9;13,9;14,9;15,9;16,9;17,9;23,9;26,9;28,9;4,10;9,10;18,10;19,10;24,10;26,10;28,10;4,11;6,11;8,11;10,11;13,11;14,11;15,11;16,11;17,11;20,11;22,11;24,11;26,11;28,11;3,12;5,12;8,12;10,12;12,12;20,12;22,12;25,12;27,12;29,12;3,13;5,13;7,13;9,13;14,13;15,13;16,13;21,13;23,13;25,13;27,13;29,13;3,14;5,14;7,14;9,14;11,14;13,14;17,14;19,14;21,14;23,14;25,14;27,14;29,14;1,15;3,15;5,15;7,15;9,15;11,15;13,15;15,15;17,15;19,15;21,15;23,15;25,15;27,15;29,15;1,16;3,16;5,16;7,16;9,16;11,16;13,16;15,16;17,16;19,16;21,16;23,16;25,16;27,16;29,16;1,17;3,17;5,17;7,17;9,17;11,17;13,17;15,17;17,17;19,17;21,17;23,17;25,17;27,17;29,17;1,18;3,18;5,18;7,18;9,18;11,18;13,18;15,18;19,18;21,18;23,18;25,18;27,18;29,18;1,19;3,19;5,19;7,19;9,19;11,19;13,19;15,19;19,19;21,19;23,19;25,19;27,19;29,19;1,20;3,20;5,20;7,20;9,20;11,20;15,20;19,20;21,20;23,20;25,20;27,20;29,20;1,21;3,21;5,21;7,21;9,21;11,21;21,21;23,21;25,21;27,21;29,21;1,22;3,22;5,22;7,22;9,22;11,22;21,22;23,22;25,22;27,22;29,22;1,23;3,23;5,23;7,23;9,23;11,23;21,23;23,23;25,23;27,23;29,23;1,24;3,24;5,24;7,24;9,24;21,24;23,24;25,24;27,24;29,24;1,25;3,25;5,25;7,25;9,25;23,25;25,25;27,25;29,25;1,26;3,26;5,26;7,26;9,26;23,26;25,26;27,26;29,26;1,27;3,27;5,27;7,27;23,27;25,27;27,27;29,27;3,28;5,28;7,28;23,28;27,28;29,28;3,29;5,29;7,29;27,29;29,29;3,30;5,30;27,30;29,30;3,31;5,31;27,31;29,31;5,32;27,32;29,32;27,33';
  function fingerprintSVG(cls) {
    var out = FP_CELLS.split(';').map(function (c) {
      var q = c.split(',');
      return '<rect x="' + (+q[0] + 0.17) + '" y="' + (+q[1] + 0.17) + '" width="0.66" height="0.66"/>';
    }).join('');
    return '<svg class="' + (cls || '') + '" viewBox="0 0 31 34" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + out + '</svg>';
  }
  function shuffleScan(svgRoot) {
    var rects = svgRoot ? svgRoot.querySelectorAll('rect') : [];
    for (var i = 0; i < rects.length; i++) rects[i].style.setProperty('--r', (Math.random() * 33).toFixed(2));
  }

  function b64urlFromBuf(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bufFromB64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function randomBytes(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  async function hashPin(pin, saltB64) {
    var data = new TextEncoder().encode(saltB64 + ':' + pin);
    var digest = await crypto.subtle.digest('SHA-256', data);
    return b64urlFromBuf(digest);
  }
  function todayLabel() {
    var d = new Date();
    return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  }

  root.TC = {
    SYNC_DEFAULTS: SYNC_DEFAULTS, LOCAL_DEFAULTS: LOCAL_DEFAULTS, TYPE_LABEL: TYPE_LABEL,
    isWebUrl: isWebUrl, hostOf: hostOf, normUrl: normUrl, cleanPattern: cleanPattern, hits: hits, matchRule: matchRule,
    fingerprintSVG: fingerprintSVG, shuffleScan: shuffleScan,
    b64urlFromBuf: b64urlFromBuf, bufFromB64url: bufFromB64url, randomBytes: randomBytes, hashPin: hashPin, todayLabel: todayLabel
  };
})(typeof self !== 'undefined' ? self : this);
