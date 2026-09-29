(() => {
  const form = document.querySelector('#invoice-form');
  const itemEditor = document.querySelector('#item-editor');
  const itemOutput = document.querySelector('#invoice-items');
  const dialog = document.querySelector('#gmail-dialog');
  const toast = document.querySelector('[data-toast]');
  const cookiePrefix = 'cp_invoice_state';
  const cookieLifetime = 60 * 60 * 24 * 365;
  const legacyStorageKey = 'convergence-point-invoice-details-v1';
  let itemId = 0;
  let toastTimer;
  let saveTimer;
  let isHydrating = true;

  const pad = value => String(value).padStart(2, '0');
  const toInputDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const today = new Date();
  const fields = name => form.elements.namedItem(name);

  function addDays(source, days) {
    const date = new Date(`${source}T12:00:00`);
    date.setDate(date.getDate() + days);
    return toInputDate(date);
  }

  function invoiceNumberForDate(value) {
    const compactDate = (value || toInputDate(today)).replaceAll('-', '');
    return `CP-${compactDate}-001`;
  }

  function setInitialDefaults() {
    fields('issueDate').value = toInputDate(today);
    fields('dueDate').value = addDays(fields('issueDate').value, 30);
    fields('invoiceNumber').value = invoiceNumberForDate(fields('issueDate').value);
    fields('paymentReference').value = fields('invoiceNumber').value;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/\n/g, ' ');
  }

  function activeRate() {
    return Number(fields('dayRate').value) || 0;
  }

  function quantityFromHours(hours) {
    const hoursPerDay = Number(fields('hoursPerDay').value) || 7;
    return hours / hoursPerDay;
  }

  function displayQuantity(value) {
    return Number(value.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }

  function addItem(item = {}, shouldUpdate = true) {
    const id = ++itemId;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.itemId = id;
    row.innerHTML = `
      <div class="item-row-top">
        <label>Description<input data-item="description" value="${escapeAttribute(item.description || '')}" placeholder="Service or activity"></label>
        <button class="remove-item" type="button" data-remove-item aria-label="Remove item">×</button>
      </div>
      <label>Detail <span class="optional">optional</span><textarea data-item="detail" rows="2" placeholder="Date, scope or supporting detail">${escapeHtml(item.detail || '')}</textarea></label>
      <div class="item-row-numbers">
        <label>Hours worked<input data-item="hours" type="number" min="0" step="0.01" value="${item.hours ?? item.quantity ?? 7}"></label>
        <label>VAT %<input data-item="tax" type="number" min="0" step="0.1" value="${item.tax ?? 0}"></label>
      </div>
      <div class="line-total">Line total <strong data-line-total></strong></div>`;
    itemEditor.append(row);
    if (shouldUpdate) update();
  }

  function getItems() {
    return [...itemEditor.querySelectorAll('.item-row')].map(row => {
      const value = key => row.querySelector(`[data-item="${key}"]`).value;
      return {
        row,
        description: value('description'),
        detail: value('detail'),
        hours: Number(value('hours')) || 0,
        tax: Number(value('tax')) || 0
      };
    });
  }

  function formState() {
    const state = {};
    [...form.elements].forEach(element => {
      if (!element.name || element.type === 'button') return;
      state[element.name] = element.type === 'checkbox' ? element.checked : element.value;
    });
    return state;
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    const entry = document.cookie.split('; ').find(cookie => cookie.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : '';
  }

  function writeCookie(name, value, maxAge = cookieLifetime) {
    document.cookie = `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Strict; Secure`;
  }

  function saveState() {
    try {
      const state = {
        version: 2,
        form: formState(),
        items: getItems().map(({ row, ...item }) => item)
      };
      const encoded = encodeURIComponent(JSON.stringify(state));
      const chunks = encoded.match(/.{1,3000}/g) || [''];
      const oldCount = Number(readCookie(`${cookiePrefix}_count`)) || 0;
      chunks.forEach((chunk, index) => writeCookie(`${cookiePrefix}_${index}`, chunk));
      writeCookie(`${cookiePrefix}_count`, String(chunks.length));
      for (let index = chunks.length; index < oldCount; index += 1) writeCookie(`${cookiePrefix}_${index}`, '', 0);
    } catch (_) {
      showToast('This browser could not save the invoice cookies.');
    }
  }

  function scheduleSave() {
    if (isHydrating) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 250);
  }

  function loadState() {
    try {
      const count = Number(readCookie(`${cookiePrefix}_count`)) || 0;
      if (!count) return null;
      let encoded = '';
      for (let index = 0; index < count; index += 1) encoded += readCookie(`${cookiePrefix}_${index}`);
      return JSON.parse(decodeURIComponent(encoded));
    } catch (_) {
      return null;
    }
  }

  function applyFormState(savedForm) {
    if (!savedForm) return;
    Object.entries(savedForm).forEach(([name, value]) => {
      const input = fields(name);
      if (!input || name === 'invoiceNumber') return;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    });
  }

  function migrateLegacyDetails() {
    try {
      const legacy = JSON.parse(localStorage.getItem(legacyStorageKey));
      if (!legacy) return;
      applyFormState(legacy);
      localStorage.removeItem(legacyStorageKey);
    } catch (_) {
      localStorage.removeItem(legacyStorageKey);
    }
  }

  function syncInvoiceNumber() {
    const previousNumber = fields('invoiceNumber').value;
    const nextNumber = invoiceNumberForDate(fields('issueDate').value);
    fields('invoiceNumber').value = nextNumber;
    if (!fields('paymentReference').value.trim() || fields('paymentReference').value === previousNumber) {
      fields('paymentReference').value = nextNumber;
    }
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

    const rate = activeRate();
    itemOutput.innerHTML = '';
    let subtotal = 0;
    let totalTax = 0;
    getItems().forEach(item => {
      const quantity = quantityFromHours(item.hours);
      const line = quantity * rate;
      const tax = line * (item.tax / 100);
      subtotal += line;
      totalTax += tax;
      item.row.querySelector('[data-line-total]').textContent = money(line + tax);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(item.description || 'Professional service')}<span>${escapeHtml(item.detail)}</span></td><td>${displayQuantity(item.hours)}</td><td>${displayQuantity(quantity)}</td><td>${money(rate)}</td><td>${item.tax ? `${item.tax}%` : '—'}</td><td>${money(line + tax)}</td>`;
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
    scheduleSave();
  }

  function splitTrackerRow(line) {
    if (line.includes('\t')) return line.split('\t').map(value => value.trim());
    if (line.includes(';')) return line.split(';').map(value => value.trim());
    return line.split(/\s{2,}/).map(value => value.trim());
  }

  function parseHours(value) {
    const normalized = String(value).trim().replace(',', '.').replace(/[^0-9.-]/g, '');
    const result = Number(normalized);
    return Number.isFinite(result) ? result : NaN;
  }

  function parseTracker(text) {
    const rows = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(splitTrackerRow);
    if (!rows.length) return [];
    const first = rows[0].map(value => value.toLowerCase());
    const hasHeader = first.some(value => value.includes('date')) && first.some(value => value.includes('quantity') || value.includes('hour'));
    let dateIndex = 0;
    let hoursIndex = 1;
    let activityIndex = 2;
    if (hasHeader) {
      dateIndex = first.findIndex(value => value.includes('date'));
      hoursIndex = first.findIndex(value => value.includes('quantity') || value.includes('hour'));
      activityIndex = first.findIndex(value => value.includes('activity') || value.includes('description'));
      rows.shift();
    }
    return rows.map(columns => {
      const hours = parseHours(columns[hoursIndex]);
      if (!Number.isFinite(hours)) return null;
      const activity = activityIndex >= 0 ? columns.slice(activityIndex).join(' ').trim() : '';
      const date = columns[dateIndex] || '';
      return {
        description: activity || 'Professional services',
        detail: date ? `Work completed: ${date}` : '',
        hours,
        tax: 0
      };
    }).filter(Boolean);
  }

  function importTrackerItems() {
    const imported = parseTracker(fields('timeImport').value);
    if (!imported.length) {
      showToast('No rows found. Paste the Date, Quantity (Hours) and Activity columns from Excel.');
      return;
    }
    itemEditor.innerHTML = '';
    imported.forEach(item => addItem(item, false));
    update();
    showToast(`${imported.length} ${imported.length === 1 ? 'item' : 'items'} added from your tracker.`);
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
    if (event.target.name === 'issueDate') syncInvoiceNumber();
    update();
  });
  form.addEventListener('change', event => {
    if (event.target.name === 'issueDate') syncInvoiceNumber();
    update();
  });

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
    if (action === 'import-items') importTrackerItems();
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

  setInitialDefaults();
  const saved = loadState();
  if (saved?.form) applyFormState(saved.form);
  else migrateLegacyDetails();
  syncInvoiceNumber();
  const savedItems = Array.isArray(saved?.items) ? saved.items : [];
  if (savedItems.length) savedItems.forEach(item => addItem(item, false));
  else addItem({ description: 'Professional services', hours: 7, tax: 0 }, false);
  isHydrating = false;
  update();
})();
