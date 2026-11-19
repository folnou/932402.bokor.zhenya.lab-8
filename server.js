const path = require('path');
const express = require('express');
const {
  getTransaction,
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary
} = require('./db');

const app = express();
const PORT = process.env.PORT || 6767;

const TYPES = ['income', 'expense'];
const MAX_AMOUNT = 1_000_000_000;
const MAX_CATEGORY_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseAmount(value) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    number = Number(value.replace(/\s/g, '').replace(',', '.'));
  } else {
    return null;
  }
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function validateTransaction(body) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];

  if (!TYPES.includes(source.type)) {
    errors.push('Тип должен быть income или expense');
  }

  const amount = parseAmount(source.amount);
  if (amount === null) {
    errors.push('Сумма должна быть числом');
  } else if (amount <= 0) {
    errors.push('Сумма должна быть больше нуля');
  } else if (amount > MAX_AMOUNT) {
    errors.push('Сумма слишком велика');
  }

  const category = typeof source.category === 'string' ? source.category.trim() : '';
  if (category === '') {
    errors.push('Укажите категорию');
  } else if (category.length > MAX_CATEGORY_LENGTH) {
    errors.push(`Категория не длиннее ${MAX_CATEGORY_LENGTH} символов`);
  }

  if (!isValidDate(source.date)) {
    errors.push('Дата должна быть в формате ГГГГ-ММ-ДД');
  }

  let description = '';
  if (source.description !== undefined && source.description !== null) {
    if (typeof source.description !== 'string') {
      errors.push('Описание должно быть строкой');
    } else {
      description = source.description.trim();
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        errors.push(`Описание не длиннее ${MAX_DESCRIPTION_LENGTH} символов`);
      }
    }
  }

  if (errors.length > 0) return { errors };
  return { value: { type: source.type, amount, category, date: source.date, description } };
}

function validatePeriod(query) {
  const errors = [];
  const value = {};

  for (const key of ['from', 'to']) {
    if (query[key] === undefined || query[key] === '') continue;
    if (!isValidDate(query[key])) {
      errors.push(`Параметр ${key} должен быть датой в формате ГГГГ-ММ-ДД`);
    } else {
      value[key] = query[key];
    }
  }

  if (value.from && value.to && value.from > value.to) {
    errors.push('Начало периода не может быть позже конца');
  }

  return errors.length > 0 ? { errors } : { value };
}

function validateFilters(query) {
  const period = validatePeriod(query);
  const errors = period.errors ? [...period.errors] : [];
  const value = period.value ? { ...period.value } : {};

  if (query.type !== undefined && query.type !== '') {
    if (!TYPES.includes(query.type)) {
      errors.push('Параметр type должен быть income или expense');
    } else {
      value.type = query.type;
    }
  }

  if (query.category !== undefined && query.category !== '') {
    if (typeof query.category !== 'string') {
      errors.push('Параметр category должен быть строкой');
    } else {
      value.category = query.category.trim();
    }
  }

  return errors.length > 0 ? { errors } : { value };
}

function sendValidationError(res, errors) {
  res.status(400).json({ error: errors.join('; '), details: errors });
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get(
  '/api/transactions',
  asyncHandler(async (req, res) => {
    const result = validateFilters(req.query);
    if (result.errors) return sendValidationError(res, result.errors);
    res.json(await listTransactions(result.value));
  })
);

app.get(
  '/api/transactions/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный id' });

    const transaction = await getTransaction(id);
    if (!transaction) return res.status(404).json({ error: 'Транзакция не найдена' });
    res.json(transaction);
  })
);

app.post(
  '/api/transactions',
  asyncHandler(async (req, res) => {
    const result = validateTransaction(req.body);
    if (result.errors) return sendValidationError(res, result.errors);

    const created = await createTransaction(result.value);
    res.status(201).location(`/api/transactions/${created.id}`).json(created);
  })
);

app.put(
  '/api/transactions/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный id' });

    const result = validateTransaction(req.body);
    if (result.errors) return sendValidationError(res, result.errors);

    const updated = await updateTransaction(id, result.value);
    if (!updated) return res.status(404).json({ error: 'Транзакция не найдена' });
    res.json(updated);
  })
);

app.delete(
  '/api/transactions/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Некорректный id' });

    if (!(await deleteTransaction(id))) {
      return res.status(404).json({ error: 'Транзакция не найдена' });
    }
    res.status(204).end();
  })
);

app.get(
  '/api/summary',
  asyncHandler(async (req, res) => {
    const result = validatePeriod(req.query);
    if (result.errors) return sendValidationError(res, result.errors);
    res.json(await getSummary(result.value));
  })
);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Приложение запущено: http://localhost:${PORT}`);
  });
}

module.exports = app;
