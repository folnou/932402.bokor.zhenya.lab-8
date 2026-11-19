const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'budget.db');
const db = new sqlite3.Database(DB_PATH);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
    amount      REAL    NOT NULL CHECK (amount > 0),
    category    TEXT    NOT NULL CHECK (length(trim(category)) > 0),
    date        TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    description TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
  CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions (type, date);
`;

const FIELDS = 'id, type, amount, category, date, description';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => (error ? reject(error) : resolve(row || null)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => (error ? reject(error) : resolve()));
  });
}

const ready = exec(SCHEMA);

function round2(value) {
  return Math.round(value * 100) / 100;
}

function buildWhere({ type, from, to, category } = {}) {
  const clauses = [];
  const params = [];

  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (from) {
    clauses.push('date >= ?');
    params.push(from);
  }
  if (to) {
    clauses.push('date <= ?');
    params.push(to);
  }
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

async function getTransaction(id) {
  await ready;
  return get(`SELECT ${FIELDS} FROM transactions WHERE id = ?`, [id]);
}

async function listTransactions(filters) {
  await ready;
  const { sql, params } = buildWhere(filters);
  return all(`SELECT ${FIELDS} FROM transactions ${sql} ORDER BY date DESC, id DESC`, params);
}

async function createTransaction({ type, amount, category, date, description }) {
  await ready;
  const result = await run(
    'INSERT INTO transactions (type, amount, category, date, description) VALUES (?, ?, ?, ?, ?)',
    [type, amount, category, date, description]
  );
  return getTransaction(result.lastID);
}

async function updateTransaction(id, { type, amount, category, date, description }) {
  await ready;
  const result = await run(
    'UPDATE transactions SET type = ?, amount = ?, category = ?, date = ?, description = ? WHERE id = ?',
    [type, amount, category, date, description, id]
  );
  return result.changes > 0 ? getTransaction(id) : null;
}

async function deleteTransaction(id) {
  await ready;
  const result = await run('DELETE FROM transactions WHERE id = ?', [id]);
  return result.changes > 0;
}

async function getSummary(period) {
  await ready;
  const { sql, params } = buildWhere(period);

  const totalsRows = await all(
    `SELECT type, ROUND(SUM(amount), 2) AS total FROM transactions ${sql} GROUP BY type`,
    params
  );

  const totals = { income: 0, expense: 0 };
  totalsRows.forEach((row) => {
    totals[row.type] = row.total;
  });

  const byCategory = await all(
    `SELECT category, type, ROUND(SUM(amount), 2) AS total, COUNT(*) AS count
     FROM transactions ${sql}
     GROUP BY category, type
     ORDER BY total DESC`,
    params
  );

  return {
    income: totals.income,
    expense: totals.expense,
    balance: round2(totals.income - totals.expense),
    byCategory
  };
}

async function countTransactions() {
  await ready;
  const row = await get('SELECT COUNT(*) AS total FROM transactions');
  return row.total;
}

async function resetTable() {
  await ready;
  await exec('DROP TABLE IF EXISTS transactions');
  await exec(SCHEMA);
}

function close() {
  return new Promise((resolve, reject) => {
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

function isoDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function initDatabase({ reset = false } = {}) {
  if (reset) {
    await resetTable();
    console.log('Таблица transactions пересоздана');
  }

  const total = await countTransactions();
  if (total > 0) {
    console.log(`В таблице уже есть записи (${total}), тестовые данные не добавлены`);
    return;
  }

  const samples = [
    { type: 'income', amount: 120000, category: 'Зарплата', date: isoDate(25), description: 'Аванс' },
    { type: 'income', amount: 45000, category: 'Фриланс', date: isoDate(12), description: 'Вёрстка лендинга' },
    { type: 'expense', amount: 32000, category: 'Жильё', date: isoDate(24), description: 'Аренда' },
    { type: 'expense', amount: 7850.5, category: 'Продукты', date: isoDate(20), description: 'Закупка на неделю' },
    { type: 'expense', amount: 4300, category: 'Продукты', date: isoDate(9), description: '' },
    { type: 'expense', amount: 2400, category: 'Транспорт', date: isoDate(7), description: 'Проездной' },
    { type: 'expense', amount: 5600, category: 'Развлечения', date: isoDate(5), description: 'Кино и кафе' },
    { type: 'expense', amount: 3100, category: 'Здоровье', date: isoDate(3), description: 'Аптека' },
    { type: 'income', amount: 120000, category: 'Зарплата', date: isoDate(1), description: 'Основная часть' }
  ];

  for (const sample of samples) {
    await createTransaction(sample);
  }
  console.log(`Добавлено тестовых транзакций: ${samples.length}`);
}

module.exports = {
  getTransaction,
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getSummary,
  countTransactions,
  resetTable,
  close
};

if (require.main === module) {
  initDatabase({ reset: process.argv.includes('--reset') })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(close);
}
