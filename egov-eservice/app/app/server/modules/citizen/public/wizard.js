/* Citizen 3-step wizard (CONTRACT §2.5). State comes from <script id="wizard-state">; every change goes
 * through the JSON APIs of CONTRACT §6.2 so the server stays the source of truth (fee table precomputed
 * by rules/, file checks by magic bytes, QR expiry by the server clock). */
(function () {
  'use strict';

  var stateEl = document.getElementById('wizard-state');
  if (!stateEl) return;
  var S = JSON.parse(stateEl.textContent);
  var sid = S.serviceId;
  var table = S.feeTable;
  var draft = S.draft;          // draftJson from the server (null until saved)
  var touched = false;
  var uploadQueue = Promise.resolve();
  var savePending = null;       // in-flight saveDraft() (files chosen meanwhile wait for the draft id)
  var pollTimer = null;

  var STEP_TEXT = { 1: '1/3 กรอกข้อมูล', 2: '2/3 แนบเอกสาร', 3: '3/3 ชำระเงิน' };
  var PAY_TEXT = { PENDING: 'รอชำระ', PAID: 'ชำระแล้ว', EXPIRED: 'QR หมดอายุ' };
  var QR_EXPIRED_MSG = 'QR หมดอายุ กรุณาสร้าง QR ใหม่';
  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var DASH = '–';

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function money(n) { return '฿' + String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function thaiDateTime(iso) {
    var ms = Date.parse(iso);
    if (isNaN(ms)) return '';
    var d = new Date(ms + 7 * 3600 * 1000);
    return d.getUTCDate() + ' ' + TH_MONTHS[d.getUTCMonth()] + ' ' + (d.getUTCFullYear() + 543) + ' ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  function sizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function errMsg(r, fallback) { return (r && r.data && r.data.message) || fallback; }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ step switching

  function goStep(n) {
    [1, 2, 3].forEach(function (i) {
      var sec = $('step-' + i);
      if (sec) sec.hidden = i !== n;
      var mark = document.querySelector('[data-step-mark="' + i + '"]');
      if (mark) { if (i === n) mark.setAttribute('aria-current', 'step'); else mark.removeAttribute('aria-current'); }
    });
    $('wizard-step').textContent = STEP_TEXT[n];
    if (n === 2) renderFiles();
    if (n === 3) renderPayment();
    if (n !== 3) stopPolling();
  }

  function setDraft(d) {
    draft = d;
    if (!d) return;
    $('draft-line').hidden = false;
    $('draft-id').textContent = d.draftId;
    var url = '/citizen/new/' + sid + '?draft=' + encodeURIComponent(d.draftId);
    if (window.location.pathname + window.location.search !== url) {
      try { window.history.replaceState(null, '', url); } catch (_) { /* ignore */ }
    }
    var locked = d.status !== 'DRAFT';
    var inp = feeInput();
    if (inp) inp.readOnly = locked;
    $('save-draft-btn').disabled = locked;
  }

  function reloadDraft(id) {
    return egov.api('GET', '/api/drafts/' + encodeURIComponent(id || draft.draftId)).then(function (r) {
      if (r.ok) setDraft(r.data);
      return r;
    });
  }

  // ------------------------------------------------------------------ step 1: fee

  function feeInput() { return $('qty-input') || $('area-input'); }

  function quote() {
    if (draft && draft.feeLocked) return { fee: draft.fee, value: sid === 'SV-01' ? draft.qty : draft.areaSqm };
    if (sid === 'SV-02') return { fee: table.flat };
    var raw = String(feeInput().value).trim();
    if (!/^-?\d+$/.test(raw)) return { error: table.errorInvalid };
    var n = Number(raw);
    if (n < table.min) return { error: table.errorBelow };
    if (n > table.max) return { error: table.errorAbove };
    var fee = table.valid[n];
    if (fee === undefined) return { error: table.errorInvalid };
    return { fee: fee, value: n };
  }

  function showFeeError(msg) {
    var e = $('fee-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function renderFee() {
    var q = quote();
    $('fee-total').textContent = q.error ? DASH : money(q.fee);
    showFeeError(q.error && touched ? q.error : '');
    $('to-upload-btn').disabled = !!q.error;
    return q;
  }

  /** Create (POST) or update (PATCH) the draft with the current input. Resolves the draft or null. */
  function saveDraft() {
    var q = quote();
    if (q.error) { touched = true; renderFee(); return Promise.resolve(null); }
    if (draft && draft.status !== 'DRAFT') return Promise.resolve(draft);
    var body = {};
    if (sid === 'SV-01') body.qty = q.value;
    if (sid === 'SV-03') body.areaSqm = q.value;
    var req = draft
      ? egov.api('PATCH', '/api/drafts/' + encodeURIComponent(draft.draftId), body)
      : egov.api('POST', '/api/drafts', Object.assign({ serviceId: sid }, body));
    var p = req.then(function (r) {
      if (!r.ok) {
        var code = r.data && r.data.code;
        if (code === 'INVALID_QTY' || code === 'INVALID_AREA' || code === 'AREA_TOO_LARGE') showFeeError(errMsg(r, ''));
        else egov.showError(errMsg(r, 'บันทึกร่างไม่สำเร็จ'));
        return null;
      }
      return reloadDraft(r.data.draftId).then(function (r2) { return r2.ok ? draft : null; });
    });
    savePending = p;
    var clear = function () { if (savePending === p) savePending = null; };
    p.then(clear, clear);
    return p;
  }

  // ------------------------------------------------------------------ step 2: files

  function renderFiles() {
    var list = $('file-list');
    list.textContent = '';
    var files = (draft && draft.files) || [];
    var editable = !draft || draft.status === 'DRAFT';
    files.forEach(function (f) {
      var li = el('li', { 'data-testid': 'file-item', 'data-name': f.name, 'data-doc-key': f.docKey, 'data-file-id': f.fileId });
      var info = el('span', { class: 'file-info' });
      info.appendChild(el('span', { class: 'file-name' }, f.name));
      info.appendChild(el('span', { class: 'muted' }, ' · ' + docName(f.docKey) + ' · ' + sizeText(f.size)));
      li.appendChild(info);
      if (editable) {
        var btn = el('button', { type: 'button', class: 'btn-secondary btn-sm', 'data-testid': 'file-remove-btn', 'aria-label': 'ลบไฟล์ ' + f.name }, 'ลบ');
        btn.addEventListener('click', function () { removeFile(f.fileId, btn); });
        li.appendChild(btn);
      }
      list.appendChild(li);
    });
    if (!files.length) list.appendChild(el('li', { class: 'muted empty' }, 'ยังไม่มีไฟล์แนบ'));
    var missing = missingDocs(files);
    var slot = $('missing-slot');
    slot.textContent = '';
    if (missing.length) {
      slot.appendChild(el('p', { 'data-testid': 'missing-docs', class: 'field-error', id: 'missing-docs' }, 'ยังขาดเอกสาร: ' + missing.join(', ')));
    }
    $('to-payment-btn').disabled = missing.length > 0 || !draft;
    document.querySelectorAll('#step-2 input[type=file]').forEach(function (i) { i.disabled = !editable; });
    $('back-to-1').hidden = !editable;
  }

  function docName(key) {
    if (key === S.extraKey) return 'เอกสารเพิ่มเติม';
    for (var i = 0; i < S.docs.length; i++) if (S.docs[i].key === key) return S.docs[i].name;
    return key;
  }

  function missingDocs(files) {
    var have = {};
    files.forEach(function (f) { have[f.docKey] = true; });
    return S.docs.filter(function (d) { return d.required && !have[d.key]; }).map(function (d) { return d.name; });
  }

  function showUploadError(msg) {
    var e = $('upload-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function uploadOne(file, docKey) {
    var fd = new FormData();
    fd.append('docKey', docKey);
    fd.append('file', file, file.name);
    return egov.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files', fd);
  }

  function onFilesChosen(input) {
    var files = Array.prototype.slice.call(input.files || []);
    var docKey = input.getAttribute('data-doc-key');
    if (!files.length) return;
    // B13: the draft is created asynchronously by step 1 → files chosen before it exists wait for it
    var draftReady = draft ? Promise.resolve(draft) : (savePending || Promise.resolve(null));
    uploadQueue = uploadQueue.then(function () { return draftReady; }).then(function () {
      if (!draft) { showUploadError('อัปโหลดไม่สำเร็จ'); return; }
      $('upload-busy').textContent = 'กำลังอัปโหลด…';
      var chain = Promise.resolve(true);
      files.forEach(function (file) {
        chain = chain.then(function (okSoFar) {
          if (!okSoFar) return false;
          return uploadOne(file, docKey).then(function (r) {
            if (!r.ok) {
              showUploadError(r.status === 413 ? 'ไฟล์ใหญ่เกิน 5 MB' : errMsg(r, 'อัปโหลดไม่สำเร็จ'));
              return false;
            }
            showUploadError('');
            return true;
          });
        });
      });
      return chain.then(function () {
        try { input.value = ''; } catch (_) { /* ignore */ }
        return reloadDraft();
      }).then(function () {
        $('upload-busy').textContent = '';
        renderFiles();
      });
    }).catch(function () {
      $('upload-busy').textContent = '';
      showUploadError('อัปโหลดไม่สำเร็จ');
    });
  }

  function removeFile(fileId, btn) {
    btn.disabled = true;
    uploadQueue = uploadQueue.then(function () {
      return egov.api('DELETE', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/files/' + encodeURIComponent(fileId))
        .then(function (r) {
          if (!r.ok && r.status !== 404) egov.showError(errMsg(r, 'ลบไฟล์ไม่สำเร็จ'));
          return reloadDraft();
        })
        .then(renderFiles);
    });
  }

  // ------------------------------------------------------------------ step 3: payment

  function payment() { return draft && draft.payment; }

  function renderPayment() {
    var p = payment();
    var locked = draft && draft.status !== 'DRAFT';
    $('payment-amount').textContent = draft ? money(p ? p.amount : draft.fee) : DASH;
    $('back-to-2').hidden = !!locked;

    var createBtn = $('create-qr-btn');
    createBtn.hidden = !!p;
    $('create-qr-row').hidden = !!p && !!locked;

    var box = $('qr-box');
    var expiredSlot = $('expired-slot');
    var receiptSlot = $('receipt-slot');
    expiredSlot.textContent = '';
    receiptSlot.textContent = '';
    if (!p) { box.hidden = true; stopPolling(); return; }

    box.hidden = false;
    $('qr-image').setAttribute('src', '/api/payments/' + encodeURIComponent(p.ref) + '/qr.svg');
    $('qr-ref').textContent = p.ref;
    var exp = $('qr-expires');
    exp.setAttribute('data-iso', p.qrExpiresAt);
    exp.setAttribute('datetime', p.qrExpiresAt);
    exp.textContent = 'หมดอายุ ' + thaiDateTime(p.qrExpiresAt);
    var st = $('payment-status');
    st.setAttribute('data-status', p.status);
    st.className = 'chip pay-' + p.status;
    st.textContent = PAY_TEXT[p.status] || p.status;
    $('refresh-payment-btn').hidden = p.status === 'PAID';

    if (p.status === 'EXPIRED') {
      expiredSlot.appendChild(el('p', { 'data-testid': 'qr-expired-msg', class: 'field-error', role: 'alert' }, QR_EXPIRED_MSG));
      var regen = el('button', { type: 'button', 'data-testid': 'regenerate-qr-btn', id: 'regenerate-qr-btn' }, 'สร้าง QR ใหม่');
      regen.addEventListener('click', function () { createQr(regen); });
      expiredSlot.appendChild(regen);
    }
    if (p.status === 'PAID') {
      var wrap = el('div', { class: 'receipt', role: 'region', 'aria-labelledby': 'receipt-title' });
      wrap.appendChild(el('h4', { id: 'receipt-title' }, 'ใบเสร็จรับเงิน (จำลอง)'));
      var dl = el('dl', { class: 'pay-meta' });
      function row(label, node) {
        var d = el('div');
        d.appendChild(el('dt', null, label));
        var dd = el('dd');
        dd.appendChild(node);
        d.appendChild(dd);
        dl.appendChild(d);
      }
      row('เลขคำขอ', el('span', { 'data-testid': 'submitted-case-no' }, p.caseNo));
      row('เลขใบเสร็จ', el('span', { 'data-testid': 'receipt-no' }, p.receiptNo));
      row('ยอดชำระ', el('span', { 'data-testid': 'receipt-amount' }, money(p.amount)));
      row('เวลาชำระ', el('time', { 'data-testid': 'receipt-paid-at', 'data-iso': p.paidAt, datetime: p.paidAt }, thaiDateTime(p.paidAt)));
      wrap.appendChild(dl);
      wrap.appendChild(el('a', { class: 'btn', 'data-testid': 'go-case-btn', href: '/citizen/cases/' + encodeURIComponent(p.caseNo) }, 'ดูคำขอ'));
      receiptSlot.appendChild(wrap);
      stopPolling();
    } else if (p.status === 'PENDING') {
      startPolling();
    } else {
      stopPolling();
    }
  }

  function createQr(btn) {
    if (!draft) return;
    if (btn) btn.disabled = true;
    egov.api('POST', '/api/drafts/' + encodeURIComponent(draft.draftId) + '/payment').then(function (r) {
      if (!r.ok) {
        if (btn) btn.disabled = false;
        egov.showError(errMsg(r, 'สร้าง QR ไม่สำเร็จ'));
        if (r.data && r.data.code === 'MISSING_DOCS') { reloadDraft().then(function () { goStep(2); }); }
        return;
      }
      egov.clearMessages();
      reloadDraft().then(function () { if (btn) btn.disabled = false; renderPayment(); });
    });
  }

  function refreshPayment(quiet) {
    var p = payment();
    if (!p) return Promise.resolve();
    return egov.api('GET', '/api/payments/' + encodeURIComponent(p.ref)).then(function (r) {
      if (!r.ok) { if (!quiet) egov.showError(errMsg(r, 'ตรวจสอบการชำระเงินไม่สำเร็จ')); return; }
      if (draft && draft.payment && draft.payment.ref === r.data.ref) {
        draft.payment = r.data;
        if (r.data.status === 'PAID') draft.status = 'SUBMITTED';
      }
      renderPayment();
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = window.setInterval(function () { refreshPayment(true); }, 5000);
  }
  function stopPolling() {
    if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
  }

  // ------------------------------------------------------------------ wiring

  var inp = feeInput();
  if (inp) {
    inp.addEventListener('input', function () { touched = true; renderFee(); });
    inp.addEventListener('change', function () { touched = true; renderFee(); });
  }
  $('step-1-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var btn = $('to-upload-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    saveDraft().then(function (d) {
      renderFee();
      if (d) goStep(d.status === 'DRAFT' ? 2 : 3);
    });
  });
  $('save-draft-btn').addEventListener('click', function () {
    var btn = $('save-draft-btn');
    btn.disabled = true;
    saveDraft().then(function (d) {
      btn.disabled = !!(draft && draft.status !== 'DRAFT');
      if (d) egov.showSuccess('บันทึกร่าง ' + d.draftId + ' แล้ว');
    });
  });
  document.querySelectorAll('#step-2 input[type=file]').forEach(function (i) {
    i.addEventListener('change', function () { onFilesChosen(i); });
  });
  $('back-to-1').addEventListener('click', function () { goStep(1); });
  $('to-payment-btn').addEventListener('click', function () {
    var btn = $('to-payment-btn');
    btn.disabled = true;
    uploadQueue.then(function () { return reloadDraft(); }).then(function () {
      if (draft && draft.missing && draft.missing.length) { renderFiles(); return; }
      goStep(3);
    });
  });
  $('back-to-2').addEventListener('click', function () { goStep(2); });
  $('create-qr-btn').addEventListener('click', function () { createQr($('create-qr-btn')); });
  $('refresh-payment-btn').addEventListener('click', function () { refreshPayment(false); });

  // initial render
  if (draft) setDraft(draft);
  renderFee();
  goStep(S.step || 1);
})();
