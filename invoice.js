(() => {
  const form = document.querySelector('#invoice-form');
  const itemEditor = document.querySelector('#item-editor');
  const itemOutput = document.querySelector('#invoice-items');
  const dialog = document.querySelector('#gmail-dialog');
  const toast = document.querySelector('[data-toast]');
  const storageKey = 'convergence-point-invoice-details-v1';
  const persistedFields = ['sellerTradingName', 'sellerLegalName', 'sellerAddress', 'sellerEmail', 'sellerWebsite', 'sellerVat', 'bankAccountName', 'bankName', 'sortCode', 'accountNumber', 'iban', 'swift'];
  let itemId = 0;
  let toastTimer;

  const pad = value => String(value).padStart(2, '0');
  const toInputDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const today = new Date();
  const addDays = (source, days) => {
    const date = new Date(`${source}T12:00:00`);
    date.setDate(date.getDate() + days);
    return toInputDate(date);
  };

  const fields = name => form.elements.namedItem(name);
  fields('issueDate').value = toInputDate(today);
  fields('dueDate').value = addDays(fields('issueDate').value, 30);
  fields('invoiceNumber').value = `CP-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}-001`;
  fields('paymentReference').value = fields('invoiceNumber').value;

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function currencySymbol() {
    return { GBP: '£', EUR: '€', USD: '$' }[fields('currency').value] || '';
  }

  function money(value) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: fields('currency').value,
      minimumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
  }

  function addItem(item = {}) {
    const id = ++itemId;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.itemId = id;
    row.innerHTML = `
      <div class="item-row-top">
        <label>Description<input data-item="description" value="${escapeAttribute(item.description || '')}" placeholder="Service or deliverable"></label>
        <button class="remove-item" type="button" data-remove-item aria-label="Remove item">×</button>
      </div>
      <label>Detail <span class="optional">optional</span><textarea data-item="detail" rows="2" placeholder="Dates, scope or supporting detail">${escapeHtml(item.detail || '')}</textarea></label>
      <div class="item-row-numbers">
        <label>Quantity<input data-item="quantity" type="number" min="0" step="0.01" value="${item.quantity ?? 1}"></label>
        <label>Unit value (${currencySymbol()})<input data-item="unit" type="number" min="0" step="0.01" value="${item.unit ?? 0}"></label>
        <label>VAT %<input data-item="tax" type="number" min="0" step="0.1" value="${item.tax ?? 0}"></label>
      </div>
      <div class="line-total">Line total <strong data-line-total>${money((item.quantity ?? 1) * (item.unit ?? 0))}</strong></div>`;
    itemEditor.append(row);
    update();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/\n/g, ' ');
  }

  function getItems() {
    return [...itemEditor.querySelectorAll('.item-row')].map(row => {
      const value = key => row.querySelector(`[data-item="${key}"]`).value;
      return {
        row,
        description: value('description'),
        detail: value('detail'),
        quantity: Number(value('quantity')) || 0,
        unit: Number(value('unit')) || 0,
        tax: Number(value('tax')) || 0
      };
    });
  }

  function update() {
    document.querySelectorAll('[data-out]').forEach(output => {
      const input = fields(output.dataset.out);
      const rawValue = input ? input.value.trim() : '';
      const fallback = output.dataset.out === 'invoiceDescription' ? 'Professional services' : '';
      output.textContent = `${output.dataset.outPrefix || ''}${rawValue || fallback}`;
    });
    document.querySelectorAll('[data-out-date]').forEach(output => {
      output.textContent = formatDate(fields(output.dataset.outDate).value);
    });

    itemOutput.innerHTML = '';
    let subtotal = 0;
    let totalTax = 0;
    getItems().forEach(item => {
      const line = item.quantity * item.unit;
      const tax = line * (item.tax / 100);
      subtotal += line;
      totalTax += tax;
      item.row.querySelector('[data-line-total]').textContent = money(line + tax);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(item.description || 'Professional service')}<span>${escapeHtml(item.detail)}</span></td><td>${item.quantity}</td><td>${money(item.unit)}</td><td>${item.tax ? `${item.tax}%` : '—'}</td><td>${money(line + tax)}</td>`;
      itemOutput.append(tr);
    });
    document.querySelector('[data-total="subtotal"]').textContent = money(subtotal);
    document.querySelector('[data-total="tax"]').textContent = money(totalTax);
    document.querySelector('[data-total="total"]').textContent = money(subtotal + totalTax);
    document.querySelector('[data-tax-row]').hidden = totalTax === 0;
    document.querySelectorAll('.optional-output').forEach(output => {
      const valueNode = output.matches('[data-out]') ? output : output.querySelector('[data-out]');
      output.hidden = !valueNode || !valueNode.textContent.trim();
    });

    if (fields('rememberDetails').checked) saveDetails();
  }

  function saveDetails() {
    const saved = Object.fromEntries(persistedFields.map(name => [name, fields(name).value]));
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }

  function loadDetails() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved) return;
      persistedFields.forEach(name => {
        if (typeof saved[name] === 'string') fields(name).value = saved[name];
      });
      fields('rememberDetails').checked = true;
    } catch (_) {
      localStorage.removeItem(storageKey);
    }
  }

  function exportPdf() {
    const previousTitle = document.title;
    document.title = `${fields('invoiceNumber').value || 'Invoice'}-${fields('clientCompany').value || 'Client'}`.replace(/[^a-z0-9-_]+/gi, '-');
    window.print();
    setTimeout(() => { document.title = previousTitle; }, 600);
  }

  function openGmail() {
    const client = fields('clientName').value.trim() || 'there';
    const invoiceNo = fields('invoiceNumber').value.trim();
    const total = document.querySelector('[data-total="total"]').textContent;
    const subject = `Invoice ${invoiceNo} — Convergence Point`;
    const body = `Hi ${client},\n\nPlease find attached invoice ${invoiceNo} for ${total}, due on ${formatDate(fields('dueDate').value)}.\n\nPlease let me know if you have any questions.\n\nBest,\nLaura\nConvergence Point`;
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(fields('clientEmail').value.trim())}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    dialog.close();
  }

  form.addEventListener('input', event => {
    if (event.target.name === 'invoiceNumber' && !fields('paymentReference').dataset.edited) {
      fields('paymentReference').value = event.target.value;
    }
    if (event.target.name === 'paymentReference') event.target.dataset.edited = 'true';
    update();
  });
  form.addEventListener('change', update);

  itemEditor.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-item]');
    if (!remove) return;
    if (getItems().length === 1) {
      showToast('An invoice needs at least one item.');
      return;
    }
    remove.closest('.item-row').remove();
    update();
  });

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'add-item') addItem();
    if (action === 'preview') document.body.classList.add('preview-mode');
    if (action === 'close-preview') document.body.classList.remove('preview-mode');
    if (action === 'pdf') exportPdf();
    if (action === 'gmail') dialog.showModal();
    if (action === 'open-gmail') openGmail();
    if (action === 'close-dialog') dialog.close();
  });

  document.querySelectorAll('[data-due-days]').forEach(button => button.addEventListener('click', () => {
    fields('dueDate').value = addDays(fields('issueDate').value, Number(button.dataset.dueDays));
    update();
  }));

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.body.classList.remove('preview-mode');
  });

  loadDetails();
  addItem({ description: 'Professional services', quantity: 1, unit: 475, tax: 0 });
  update();
})();
