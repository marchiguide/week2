/* /citizen — delete a draft (DRAFT / unpaid PENDING_PAYMENT). */
(function () {
  'use strict';
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-delete-draft]');
    if (!btn) return;
    var id = btn.getAttribute('data-delete-draft');
    if (!window.confirm('ลบร่าง ' + id + ' ใช่หรือไม่ (QR ที่สร้างไว้จะใช้ไม่ได้)')) return;
    btn.disabled = true;
    egov.api('DELETE', '/api/drafts/' + encodeURIComponent(id)).then(function (r) {
      if (r.ok) { window.location.reload(); return; }
      btn.disabled = false;
      egov.showError((r.data && r.data.message) || 'ลบร่างไม่สำเร็จ');
    });
  });
})();
