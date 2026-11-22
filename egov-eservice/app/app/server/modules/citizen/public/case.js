/* /citizen/cases/:caseNo — cancel (with no-refund confirm) and resubmit after NEED_FIX. */
(function () {
  'use strict';

  var page = document.getElementById('case-page');
  if (!page) return;
  var caseNo = page.getAttribute('data-case-no');
  var base = '/api/cases/' + encodeURIComponent(caseNo);

  function $(id) { return document.getElementById(id); }
  function errMsg(r, fallback) { return (r && r.data && r.data.message) || fallback; }

  // ---------------------------------------------------------------- cancel
  var cancelBtn = $('cancel-case-btn');
  var box = $('cancel-confirm');
  if (cancelBtn && box) {
    cancelBtn.addEventListener('click', function () {
      box.hidden = false;
      cancelBtn.setAttribute('aria-expanded', 'true');
      $('confirm-cancel-btn').focus();
    });
    $('cancel-abort-btn').addEventListener('click', function () {
      box.hidden = true;
      cancelBtn.setAttribute('aria-expanded', 'false');
      cancelBtn.focus();
    });
    $('confirm-cancel-btn').addEventListener('click', function () {
      var btn = $('confirm-cancel-btn');
      btn.disabled = true;
      egov.api('POST', base + '/cancel').then(function (r) {
        if (r.ok) { window.location.reload(); return; }
        btn.disabled = false;
        box.hidden = true;
        cancelBtn.setAttribute('aria-expanded', 'false');
        egov.showError(errMsg(r, 'ยกเลิกคำขอไม่สำเร็จ'));
      });
    });
  }

  // ---------------------------------------------------------------- resubmit (NEED_FIX)
  var form = $('fix-form');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = $('submit-fix-btn');
      if (btn.disabled) return;
      btn.disabled = true;
      var fd = new FormData();
      fd.append('docKey', $('fix-doc-key').value);
      var files = $('fix-upload-input').files || [];
      for (var i = 0; i < files.length; i++) fd.append('file', files[i], files[i].name);
      egov.api('POST', base + '/resubmit', fd).then(function (r) {
        if (r.ok) { window.location.reload(); return; }
        btn.disabled = false;
        egov.showError(errMsg(r, 'ส่งแก้ไขไม่สำเร็จ'));
        if (r.data && r.data.code === 'FIX_WINDOW_EXPIRED') window.setTimeout(function () { window.location.reload(); }, 1500);
      });
    });
  }
})();
