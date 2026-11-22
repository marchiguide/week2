/* Block B06 — officer queue + case page behaviour. Uses window.egov (/static/app.js). */
(function () {
  'use strict';

  var STATUS_TEXT = { IN_REVIEW: 'กำลังตรวจสอบ' };

  function $(sel, root) { return (root || document).querySelector(sel); }

  function formatId(d) {
    d = String(d || '').replace(/\D/g, '');
    if (d.length !== 13) return d;
    return d[0] + '-' + d.slice(1, 5) + '-' + d.slice(5, 10) + '-' + d.slice(10, 12) + '-' + d[12];
  }

  function msgOf(res) {
    return (res && res.data && res.data.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
  }

  /** Field-level error element (created on first use, so it does not exist before an error). */
  function fieldError(slotId, testid, text) {
    var slot = document.getElementById(slotId);
    if (!slot) return;
    var el = slot.querySelector('[data-testid="' + testid + '"]');
    if (!el) {
      el = document.createElement('span');
      el.setAttribute('data-testid', testid);
      el.setAttribute('role', 'alert');
      slot.appendChild(el);
    }
    el.textContent = text;
  }
  function clearFieldError(slotId) {
    var slot = document.getElementById(slotId);
    if (slot) slot.textContent = '';
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }

  // ---------------------------------------------------------------- queue page

  var filter = $('[data-testid="queue-filter"]');
  var results = document.getElementById('queue-results');
  var filterSeq = 0;
  if (filter && results) {
    // Swap the table in place (no navigation) so the page never reloads under the user.
    filter.addEventListener('change', function () {
      var value = filter.value;
      var url = '/officer/queue?filter=' + encodeURIComponent(value);
      var seq = ++filterSeq;
      fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
        .then(function (res) { return res.ok ? res.text() : Promise.reject(res.status); })
        .then(function (html) {
          if (seq !== filterSeq) return; // a newer filter request won
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var fresh = doc.getElementById('queue-results');
          if (!fresh) { window.location.href = url; return; }
          results.innerHTML = fresh.innerHTML;
          var wlNew = doc.querySelector('[data-testid="workload-count"]');
          var wl = $('[data-testid="workload-count"]');
          if (wl && wlNew) wl.textContent = wlNew.textContent;
          if (window.history && window.history.replaceState) window.history.replaceState(null, '', url);
        })
        .catch(function () { window.location.href = url; });
    });
  }

  if (results) {
    results.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-testid="claim-btn"]');
      if (!btn) return;
      ev.preventDefault();
      var caseNo = btn.getAttribute('data-case-no');
      busy(btn, true);
      window.egov.api('POST', '/api/officer/cases/' + encodeURIComponent(caseNo) + '/claim').then(function (res) {
        if (!res.ok) {
          busy(btn, false);
          window.egov.showError(msgOf(res));
          return;
        }
        var owner = (res.data && res.data.owner) || '';
        var row = btn.closest('[data-testid="queue-row"]');
        if (row) {
          row.setAttribute('data-owner', owner);
          row.setAttribute('data-status', 'IN_REVIEW');
          var o = row.querySelector('[data-testid="row-owner"]');
          if (o) o.textContent = owner;
          var st = row.querySelector('[data-testid="row-status"]');
          if (st) {
            st.textContent = STATUS_TEXT.IN_REVIEW;
            st.setAttribute('data-status', 'IN_REVIEW');
            st.className = 'chip status-IN_REVIEW';
          }
        }
        if (btn.parentNode) btn.parentNode.removeChild(btn);
        var wl = $('[data-testid="workload-count"]');
        if (wl) wl.textContent = String((parseInt(wl.textContent, 10) || 0) + 1);
        window.egov.showSuccess('รับเรื่อง ' + caseNo + ' แล้ว');
      });
    });
  }

  // ---------------------------------------------------------------- case page

  var root = document.getElementById('case-root');
  if (!root) return;
  var caseNo = root.getAttribute('data-case-no');
  var enc = encodeURIComponent(caseNo);
  var URLS = {
    claim: '/api/officer/cases/' + enc + '/claim',
    'return': '/api/officer/cases/' + enc + '/return',
    forward: '/api/officer/cases/' + enc + '/forward',
    approve: '/api/cases/' + enc + '/approve',
    reject: '/api/cases/' + enc + '/reject',
    issue: '/api/officer/cases/' + enc + '/issue',
    unmask: '/api/officer/cases/' + enc + '/unmask',
  };

  function toggle(btnTestid, panelId, focusId) {
    var btn = $('[data-testid="' + btnTestid + '"]', root);
    var panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', function () {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var f = document.getElementById(focusId);
      if (f) f.focus();
    });
  }
  toggle('return-btn', 'return-panel', 'return-reason');
  toggle('reject-btn', 'reject-panel', 'reject-reason');
  toggle('show-full-id-btn', 'unmask-panel', 'unmask-reason');

  function bodyFor(action) {
    if (action === 'return') return { reason: ($('#return-reason') || {}).value || '' };
    if (action === 'reject') return { reason: ($('#reject-reason') || {}).value || '' };
    if (action === 'forward') return { note: ($('#forward-note') || {}).value || '' };
    return undefined;
  }

  root.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-action]');
    if (!btn || !root.contains(btn)) return;
    var action = btn.getAttribute('data-action');
    if (!URLS[action]) return;
    ev.preventDefault();
    window.egov.clearMessages();
    var slot = action === 'return' ? 'return-error-slot' : action === 'reject' ? 'reject-error-slot' : null;
    if (slot) clearFieldError(slot);
    busy(btn, true);
    window.egov.api('POST', URLS[action], bodyFor(action)).then(function (res) {
      if (res.ok) {
        window.location.reload();
        return;
      }
      busy(btn, false);
      var code = res.data && res.data.code;
      if (slot && code === 'REASON_TOO_SHORT') {
        fieldError(slot, action + '-reason-error', msgOf(res));
      } else {
        window.egov.showError(msgOf(res));
      }
    });
  });

  var unmaskSubmit = $('[data-testid="unmask-submit"]', root);
  if (unmaskSubmit) {
    unmaskSubmit.addEventListener('click', function (ev) {
      ev.preventDefault();
      clearFieldError('unmask-error-slot');
      var reason = ($('#unmask-reason') || {}).value || '';
      busy(unmaskSubmit, true);
      window.egov.api('POST', URLS.unmask, { reason: reason }).then(function (res) {
        busy(unmaskSubmit, false);
        if (!res.ok) {
          if (res.data && res.data.code === 'REASON_REQUIRED') fieldError('unmask-error-slot', 'unmask-error', msgOf(res));
          else window.egov.showError(msgOf(res));
          return;
        }
        var slotEl = document.getElementById('full-id-slot');
        var el = slotEl.querySelector('[data-testid="full-id"]');
        if (!el) {
          el = document.createElement('strong');
          el.setAttribute('data-testid', 'full-id');
          slotEl.appendChild(el);
        }
        el.textContent = formatId(res.data && res.data.idNo);
        document.getElementById('unmask-panel').hidden = true;
        var show = $('[data-testid="show-full-id-btn"]', root);
        if (show) show.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
