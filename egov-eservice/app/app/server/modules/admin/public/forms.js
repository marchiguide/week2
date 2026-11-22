'use strict';

document.addEventListener('change', event => {
  const role = event.target;
  if (!role.matches('[data-testid="user-role-select"]')) return;
  const dept = role.form.elements.dept;
  dept.disabled = role.value !== 'officer';
  if (dept.disabled) dept.value = '';
});

document.addEventListener('submit', async event => {
  const form = event.target;
  const method = form.dataset.adminMethod;
  if (!method) return;
  event.preventDefault();

  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  window.egov.clearMessages();

  try {
    const fields = Object.fromEntries(new FormData(form));
    for (const input of form.querySelectorAll('input[type="number"]')) {
      fields[input.name] = input.valueAsNumber;
    }
    const result = await window.egov.api(method, form.action, method === 'DELETE' ? undefined : fields);
    if (!result.ok) {
      window.egov.showError(result.data.message || 'บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } else if (form.hasAttribute('data-admin-reload')) {
      window.location.reload();
      return;
    } else {
      window.egov.showSuccess('บันทึกสำเร็จ');
    }
  } catch {
    window.egov.showError('บันทึกไม่สำเร็จ กรุณาลองใหม่');
  }
  button.disabled = false;
});
