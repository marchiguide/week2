/* Shared client helpers (B01). window.egov.{api, showError, showSuccess, clearMessages} */
(function () {
  'use strict';

  function flashArea() { return document.getElementById('flash') || document.querySelector('main') || document.body; }

  /** Show text in THE single [data-testid=action-error|action-success] element (created in #flash if absent). */
  function show(testid, cls, msg) {
    var el = document.querySelector('[data-testid="' + testid + '"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', testid);
      el.className = 'alert ' + cls;
      if (testid === 'action-error') el.setAttribute('role', 'alert');
      else el.setAttribute('role', 'status');
      flashArea().appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    return el;
  }
  function hide(testid) {
    var el = document.querySelector('[data-testid="' + testid + '"]');
    if (el) { el.textContent = ''; el.hidden = true; }
  }

  /**
   * fetch JSON helper. Resolves {ok, status, data}. Never throws on HTTP errors.
   * body: object → JSON · FormData → multipart
   */
  function api(method, url, body) {
    var opts = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var p = ct.indexOf('application/json') >= 0 ? res.json() : res.text();
      return p.then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }

  window.egov = {
    api: api,
    showError: function (msg) { hide('action-success'); return show('action-error', 'alert-error', msg); },
    showSuccess: function (msg) { hide('action-error'); return show('action-success', 'alert-success', msg); },
    clearMessages: function () { hide('action-error'); hide('action-success'); },
  };

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-logout]');
    if (!btn) return;
    ev.preventDefault();
    btn.disabled = true;
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(function () {})
      .then(function () { window.location.href = '/login'; });
  });
})();
