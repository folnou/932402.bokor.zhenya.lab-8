class ApiError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(path, window.location.origin);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new ApiError('Нет связи с сервером');
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error || 'Ошибка сервера', data?.details || []);
  }
  return data;
}

const api = {
  list: (filters) => request('/api/transactions', { params: filters }),
  summary: (period) => request('/api/summary', { params: period }),
  create: (data) => request('/api/transactions', { method: 'POST', body: data }),
  update: (id, data) => request(`/api/transactions/${id}`, { method: 'PUT', body: data }),
  remove: (id) => request(`/api/transactions/${id}`, { method: 'DELETE' })
};

const DEFAULT_CATEGORIES = [
  'Зарплата',
  'Фриланс',
  'Продукты',
  'Жильё',
  'Транспорт',
  'Развлечения',
  'Здоровье'
];

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const dateFormat = new Intl.DateTimeFormat('ru-RU');

const state = {
  filters: { type: '', from: '', to: '' },
  transactions: [],
  summary: null,
  editingId: null,
  pendingDeleteId: null
};

let requestCounter = 0;
let toastTimer = null;

const dom = {
  addBtn: document.getElementById('add-btn'),
  filters: document.getElementById('filters'),
  filterFrom: document.getElementById('filter-from'),
  filterTo: document.getElementById('filter-to'),
  presetMonth: document.getElementById('preset-month'),
  presetAll: document.getElementById('preset-all'),
  sumIncome: document.getElementById('sum-income'),
  sumExpense: document.getElementById('sum-expense'),
  sumBalance: document.getElementById('sum-balance'),
  table: document.getElementById('tx-table'),
  tbody: document.getElementById('tx-body'),
  listEmpty: document.getElementById('list-empty'),
  tabList: document.getElementById('tab-list'),
  tabChart: document.getElementById('tab-chart'),
  chartTotals: document.getElementById('chart-totals'),
  chartExpense: document.getElementById('chart-expense'),
  chartIncome: document.getElementById('chart-income'),
  dialog: document.getElementById('tx-dialog'),
  dialogTitle: document.getElementById('dialog-title'),
  form: document.getElementById('tx-form'),
  formError: document.getElementById('form-error'),
  cancelBtn: document.getElementById('cancel-btn'),
  categoryList: document.getElementById('category-list'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmText: document.getElementById('confirm-text'),
  toast: document.getElementById('toast')
};

function el(tag, { className, text, attrs } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
  }
  node.append(...children);
  return node;
}

function toISODate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return dateFormat.format(new Date(year, month - 1, day));
}

function typeLabel(type) {
  return type === 'income' ? 'Доход' : 'Расход';
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.toggle('is-error', isError);
  dom.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 3500);
}

function renderSummary() {
  const { income, expense, balance } = state.summary;
  dom.sumIncome.textContent = money.format(income);
  dom.sumExpense.textContent = money.format(expense);
  dom.sumBalance.textContent = money.format(balance);
  dom.sumBalance.classList.toggle('negative', balance < 0);
}

function renderTable() {
  const isEmpty = state.transactions.length === 0;
  dom.listEmpty.hidden = !isEmpty;
  dom.table.hidden = isEmpty;

  const rows = state.transactions.map((tx) => {
    const sign = tx.type === 'income' ? '+' : '−';
    const amountText = `${sign}${money.format(tx.amount)}`;
    const label = `${tx.category}, ${amountText}`;

    const editBtn = el('button', {
      className: 'btn btn--ghost btn--small',
      text: 'Изменить',
      attrs: { type: 'button', 'aria-label': `Изменить операцию: ${label}` }
    });
    editBtn.addEventListener('click', () => openForm(tx));

    const deleteBtn = el('button', {
      className: 'btn btn--ghost btn--small',
      text: 'Удалить',
      attrs: { type: 'button', 'aria-label': `Удалить операцию: ${label}` }
    });
    deleteBtn.addEventListener('click', () => askDelete(tx));

    return el(
      'tr',
      {},
      el('td', { className: 'col-date' }, el('time', { text: formatDate(tx.date), attrs: { datetime: tx.date } })),
      el(
        'td',
        { className: 'col-category' },
        el('span', { className: `tag tag--${tx.type}`, text: tx.category }),
        el('span', { className: 'visually-hidden', text: ` (${typeLabel(tx.type).toLowerCase()})` })
      ),
      el('td', { className: 'col-description', text: tx.description }),
      el('td', { className: 'col-amount num' }, el('span', { className: `amount amount--${tx.type}`, text: amountText })),
      el('td', { className: 'col-actions' }, el('div', { className: 'row-actions' }, editBtn, deleteBtn))
    );
  });

  dom.tbody.replaceChildren(...rows);
}

function renderBars(listNode, rows, emptyText) {
  if (rows.length === 0) {
    listNode.replaceChildren(el('li', { className: 'empty', text: emptyText }));
    return;
  }

  const max = Math.max(...rows.map((row) => row.value));
  const items = rows.map((row) => {
    const width = max > 0 ? Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0) : 0;
    const fill = el('div', { className: `bars__fill bars__fill--${row.kind}` });
    fill.style.width = `${width}%`;

    return el(
      'li',
      { className: 'bars__row' },
      el('span', { className: 'bars__label', text: row.label }),
      el('div', { className: 'bars__track', attrs: { 'aria-hidden': 'true' } }, fill),
      el('span', { className: 'bars__value', text: row.valueText })
    );
  });

  listNode.replaceChildren(...items);
}

function categoryRows(type) {
  const rows = state.summary.byCategory.filter((row) => row.type === type);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return rows.map((row) => ({
    label: row.category,
    value: row.total,
    kind: type,
    valueText: `${money.format(row.total)} (${Math.round((row.total / total) * 100)}%)`
  }));
}

function renderCharts() {
  const { income, expense } = state.summary;

  renderBars(
    dom.chartTotals,
    [
      { label: 'Доходы', value: income, kind: 'income', valueText: money.format(income) },
      { label: 'Расходы', value: expense, kind: 'expense', valueText: money.format(expense) }
    ],
    'Нет данных'
  );
  renderBars(dom.chartExpense, categoryRows('expense'), 'Расходов за период нет');
  renderBars(dom.chartIncome, categoryRows('income'), 'Доходов за период нет');
}

function renderCategoryOptions() {
  const names = new Set(DEFAULT_CATEGORIES);
  state.transactions.forEach((tx) => names.add(tx.category));
  state.summary.byCategory.forEach((row) => names.add(row.category));

  const options = Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((name) => el('option', { attrs: { value: name } }));
  dom.categoryList.replaceChildren(...options);
}

function render() {
  renderSummary();
  renderTable();
  renderCharts();
  renderCategoryOptions();
}

async function refresh() {
  const token = ++requestCounter;
  const { type, from, to } = state.filters;

  try {
    const [transactions, summary] = await Promise.all([
      api.list({ type, from, to }),
      api.summary({ from, to })
    ]);
    if (token !== requestCounter) return;
    state.transactions = transactions;
    state.summary = summary;
    render();
  } catch (error) {
    if (token !== requestCounter) return;
    showToast(error.message, true);
  }
}

function readFilters() {
  const data = new FormData(dom.filters);
  state.filters = {
    type: data.get('type') || '',
    from: data.get('from') || '',
    to: data.get('to') || ''
  };
  dom.filterTo.min = state.filters.from;
  dom.filterFrom.max = state.filters.to;
}

function onFiltersChange() {
  readFilters();
  const { from, to } = state.filters;
  if (from && to && from > to) {
    showToast('Начало периода позже конца', true);
    return;
  }
  refresh();
}

function setPeriod(from, to) {
  dom.filterFrom.value = from;
  dom.filterTo.value = to;
  onFiltersChange();
}

function selectTab(tab) {
  [dom.tabList, dom.tabChart].forEach((node) => {
    const selected = node === tab;
    node.setAttribute('aria-selected', String(selected));
    node.tabIndex = selected ? 0 : -1;
    document.getElementById(node.getAttribute('aria-controls')).hidden = !selected;
  });
}

function onTabKeydown(event) {
  const tabs = [dom.tabList, dom.tabChart];
  const current = tabs.indexOf(document.activeElement);
  if (current === -1) return;

  let next = null;
  if (event.key === 'ArrowRight') next = tabs[(current + 1) % tabs.length];
  if (event.key === 'ArrowLeft') next = tabs[(current - 1 + tabs.length) % tabs.length];
  if (event.key === 'Home') next = tabs[0];
  if (event.key === 'End') next = tabs[tabs.length - 1];

  if (next) {
    event.preventDefault();
    next.focus();
    selectTab(next);
  }
}

function openForm(tx = null) {
  state.editingId = tx ? tx.id : null;
  dom.form.reset();
  dom.formError.textContent = '';
  dom.dialogTitle.textContent = tx ? 'Изменить операцию' : 'Новая операция';

  const fields = dom.form.elements;
  fields.type.value = tx ? tx.type : 'expense';
  fields.amount.value = tx ? tx.amount : '';
  fields.category.value = tx ? tx.category : '';
  fields.date.value = tx ? tx.date : toISODate(new Date());
  fields.description.value = tx ? tx.description : '';

  dom.dialog.showModal();
  fields.amount.focus();
}

function readForm() {
  const data = new FormData(dom.form);
  return {
    type: data.get('type'),
    amount: String(data.get('amount')).trim(),
    category: String(data.get('category')).trim(),
    date: String(data.get('date')),
    description: String(data.get('description')).trim()
  };
}

function validateForm(data) {
  const amount = Number(data.amount.replace(/\s/g, '').replace(',', '.'));
  if (data.amount === '' || !Number.isFinite(amount) || amount <= 0) {
    return { field: 'amount', message: 'Сумма должна быть больше нуля' };
  }
  if (data.category === '') {
    return { field: 'category', message: 'Укажите категорию' };
  }
  if (data.date === '') {
    return { field: 'date', message: 'Укажите дату' };
  }
  return null;
}

async function onFormSubmit(event) {
  event.preventDefault();
  dom.formError.textContent = '';

  const data = readForm();
  const problem = validateForm(data);
  if (problem) {
    dom.formError.textContent = problem.message;
    dom.form.elements[problem.field].focus();
    return;
  }

  const submitBtn = dom.form.querySelector('[type="submit"]');
  submitBtn.disabled = true;

  try {
    const wasEditing = state.editingId !== null;
    if (wasEditing) {
      await api.update(state.editingId, data);
    } else {
      await api.create(data);
    }
    dom.dialog.close();
    showToast(wasEditing ? 'Операция обновлена' : 'Операция добавлена');
    await refresh();
  } catch (error) {
    dom.formError.textContent = error.message;
  } finally {
    submitBtn.disabled = false;
  }
}

function askDelete(tx) {
  state.pendingDeleteId = tx.id;
  const sign = tx.type === 'income' ? '+' : '−';
  dom.confirmText.textContent = `${formatDate(tx.date)} · ${tx.category} · ${sign}${money.format(tx.amount)}`;
  dom.confirmDialog.returnValue = '';
  dom.confirmDialog.showModal();
}

async function onConfirmClose() {
  const id = state.pendingDeleteId;
  state.pendingDeleteId = null;
  if (dom.confirmDialog.returnValue !== 'delete' || id === null) return;

  try {
    await api.remove(id);
    showToast('Операция удалена');
    await refresh();
  } catch (error) {
    showToast(error.message, true);
  }
}

dom.addBtn.addEventListener('click', () => openForm());
dom.cancelBtn.addEventListener('click', () => dom.dialog.close());
dom.form.addEventListener('submit', onFormSubmit);
dom.form.addEventListener('input', () => {
  dom.formError.textContent = '';
});
dom.confirmDialog.addEventListener('close', onConfirmClose);

dom.filters.addEventListener('change', onFiltersChange);
dom.filters.addEventListener('submit', (event) => event.preventDefault());
dom.presetAll.addEventListener('click', () => setPeriod('', ''));
dom.presetMonth.addEventListener('click', () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  setPeriod(toISODate(first), toISODate(last));
});

dom.tabList.addEventListener('click', () => selectTab(dom.tabList));
dom.tabChart.addEventListener('click', () => selectTab(dom.tabChart));
dom.tabList.parentElement.addEventListener('keydown', onTabKeydown);

refresh();
