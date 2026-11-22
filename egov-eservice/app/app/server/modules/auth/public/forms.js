(function () {
  'use strict';

  const byId = (id) => document.getElementById(id);

  function showText(element, message = '') {
    element.textContent = message;
    element.hidden = !message;
  }

  function fieldError(field, element, message) {
    showText(element, message);
    if (message) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    } else {
      field.removeAttribute('aria-invalid');
    }
  }

  function handleSubmit(form, handler) {
    const button = form.querySelector('button[type="submit"]');
    const send = (body) => window.egov.api('POST', form.getAttribute('action'), body);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      window.egov.clearMessages();
      try {
        await handler(send);
      } catch {
        window.egov.showError('ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      } finally {
        button.disabled = false;
      }
    });
  }

  function setupTabs(login) {
    const tabs = [...login.querySelectorAll('[role="tab"]')];

    function selectTab(selected) {
      for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        byId(tab.getAttribute('aria-controls')).hidden = !active;
      }
      selected.focus();
    }

    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', (event) => {
        let next;
        switch (event.key) {
          case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
          case 'ArrowRight': next = (index + 1) % tabs.length; break;
          case 'Home': next = 0; break;
          case 'End': next = tabs.length - 1; break;
          default: return;
        }
        event.preventDefault();
        selectTab(tabs[next]);
      });
    }
  }

  function setupThaiD() {
    const idField = byId('thaid-id');
    const idError = byId('thaid-error');
    const otpForm = byId('otp-form');
    const otpField = byId('otp');
    const otpError = byId('otp-error');
    const attempts = byId('otp-attempts-left');
    const lock = byId('otp-lock');
    const lockMessage = byId('lock-message');
    const lockUntil = byId('lock-until');
    const lockTimeFormat = new Intl.DateTimeFormat('th-TH', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    });
    let startedId = null;

    function showLock(data) {
      lockMessage.textContent = data.message;
      lockUntil.dateTime = data.lockedUntil;
      lockUntil.dataset.iso = data.lockedUntil;
      lockUntil.textContent = lockTimeFormat.format(new Date(data.lockedUntil));
      lock.hidden = false;
    }

    function clearOtpErrors() {
      fieldError(otpField, otpError);
      showText(attempts);
      lock.hidden = true;
    }

    function resetThaiD() {
      startedId = null;
      otpForm.hidden = true;
      otpField.value = '';
      fieldError(idField, idError);
      clearOtpErrors();
    }

    idField.addEventListener('input', resetThaiD);

    handleSubmit(byId('thaid-form'), async (send) => {
      resetThaiD();
      const idNo = idField.value;
      const { ok, data } = await send({ idNo });
      if (idField.value !== idNo) return;
      if (ok) {
        startedId = idNo;
        otpForm.hidden = false;
        otpField.focus();
      } else if (data.code === 'LOCKED') {
        showLock(data);
        idField.focus();
      } else {
        fieldError(idField, idError, data.message);
      }
    });

    handleSubmit(otpForm, async (send) => {
      const idNo = startedId;
      if (!idNo) return;
      clearOtpErrors();
      const { ok, data } = await send({ idNo, otp: otpField.value });
      if (ok) {
        window.location.assign(data.registered ? '/citizen' : '/register');
      } else if (startedId === idNo) {
        if (data.code === 'LOCKED') {
          showLock(data);
          otpField.focus();
        } else {
          if (data.code === 'OTP_INVALID') showText(attempts, `เหลือ ${data.attemptsLeft} ครั้ง`);
          fieldError(otpField, otpError, data.message);
        }
      }
    });
  }

  function setupStaff() {
    const username = byId('staff-username');
    const password = byId('staff-password');
    const error = byId('staff-error');

    handleSubmit(byId('staff-form'), async (send) => {
      fieldError(username, error);
      const { ok, data } = await send({ username: username.value, password: password.value });
      if (ok) window.location.assign(data.landing);
      else fieldError(username, error, data.message);
    });
  }

  const login = byId('login');
  if (login) {
    setupTabs(login);
    setupThaiD();
    setupStaff();
  }

  const registerForm = byId('register-form');
  if (registerForm) {
    const mobile = byId('reg-mobile');
    const email = byId('reg-email');
    const consent = byId('reg-consent');
    const mobileError = byId('reg-error-mobile');
    const consentError = byId('reg-error-consent');

    handleSubmit(registerForm, async (send) => {
      fieldError(mobile, mobileError);
      fieldError(consent, consentError);
      const { ok, data } = await send({ mobile: mobile.value, email: email.value, consent: consent.checked });
      if (ok) window.location.assign('/citizen');
      else if (data.code === 'INVALID_MOBILE') fieldError(mobile, mobileError, data.message);
      else if (data.code === 'CONSENT_REQUIRED') fieldError(consent, consentError, data.message);
      else window.egov.showError(data.message);
    });
  }
})();
