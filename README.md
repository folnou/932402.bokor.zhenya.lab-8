# Лабораторная работа №8 (Вариант 6 Планирование бюджета)

**Выполнил:** Бокор Евгений вариант 6

Итоговый мини-проект: веб-приложение для учёта личных финансов. Хранит доходы и расходы в SQLite, показывает баланс, суммы по категориям и диаграмму.

## Что реализовано по заданию

* Создана база данных SQLite (`budget.db`) и таблица `transactions` (`id`, `type`, `amount`, `category`, `date`, `description`).
* Реализованы CRUD-операции над транзакциями: добавление, просмотр, редактирование, удаление (функции в `db.js`, маршруты в `server.js`).
* Выборка по периоду (`?from=...\&to=...`), фильтр по типу (`?type=income|expense`), сводные суммы по категориям и баланс (`GET /api/summary`).
* Валидация суммы: значение должно быть больше нуля. Проверка выполняется на клиенте, на сервере и ограничением `CHECK (amount > 0)` в БД. Тип допускает только `income` и `expense`.
* Адаптивная вёрстка (на телефоне таблица превращается в карточки), модальные окна на `<dialog>`, табы «Операции» и «Аналитика».
* Диаграмма: bar-chart на CSS (доходы и расходы, суммы по категориям).
* Инициализация БД со схемой и тестовыми данными реализована в `db.js` (запуск `node db.js`). ER-диаграмма лежит в файле `ER.png`, примеры SQL-запросов приведены ниже.

## Стек и библиотеки

* Node.js
* Express (`express`)
* SQLite (`sqlite3`)
* HTML5, CSS3, JavaScript (ES6+)

## Команды для запуска

1. Установить зависимости: `npm install express sqlite3`
2. Создать таблицу и тестовые данные: `node db.js` (пересоздать с нуля: `node db.js --reset`)
3. Запустить сервер: `node server.js`
4. Открыть в браузере: `http://localhost:6767`

Шаг 2 необязателен: таблица создаётся автоматически при старте сервера, но без тестовых данных.

## Структура

```
server.js        маршруты Express и валидация данных
db.js            подключение к SQLite, схема, CRUD, выборки, агрегаты и инициализация БД (node db.js)
package.json
.gitignore
ER.png           ER-диаграмма базы данных
public/
  index.html
  style.css
  app.js
```

## ER-диаграмма

!\[ER-диаграмма](ER.png)

## API

|Метод|Путь|Описание|
|-|-|-|
|GET|`/api/transactions`|Список; фильтры `type`, `from`, `to`, `category`|
|GET|`/api/transactions/:id`|Одна транзакция|
|POST|`/api/transactions`|Создать|
|PUT|`/api/transactions/:id`|Изменить|
|DELETE|`/api/transactions/:id`|Удалить|
|GET|`/api/summary`|Доходы, расходы, баланс, суммы по категориям; параметры `from`, `to`|

Тело POST и PUT:

```json
{ "type": "expense", "amount": 1250.5, "category": "Продукты", "date": "2026-11-10", "description": "Супермаркет" }
```

Ошибки валидации: `400` и `{ "error": "...", "details": \["..."] }`. Несуществующий id: `404`.

## Примеры запросов

```bash
curl -X POST http://localhost:6767/api/transactions -H "Content-Type: application/json" -d '{"type":"expense","amount":1250.5,"category":"Продукты","date":"2026-11-10","description":"Супермаркет"}'
curl "http://localhost:6767/api/transactions?type=expense\&from=2026-11-01\&to=2026-11-30"
curl "http://localhost:6767/api/summary?from=2026-11-01\&to=2026-11-30"
curl -X PUT http://localhost:6767/api/transactions/1 -H "Content-Type: application/json" -d '{"type":"expense","amount":1300,"category":"Продукты","date":"2026-11-10","description":"Исправлено"}'
curl -i -X DELETE http://localhost:6767/api/transactions/1
curl -i -X POST http://localhost:6767/api/transactions -H "Content-Type: application/json" -d '{"type":"expense","amount":-100,"category":"Еда","date":"2026-11-10"}'
```

Пример ответа `/api/summary`:

```json
{
  "income": 285000,
  "expense": 55250.5,
  "balance": 229749.5,
  "byCategory": \[
    { "category": "Зарплата", "type": "income", "total": 240000, "count": 2 },
    { "category": "Жильё", "type": "expense", "total": 32000, "count": 1 }
  ]
}
```

## Примеры SQL-запросов

```sql
INSERT INTO transactions (type, amount, category, date, description)
VALUES ('expense', 1250.50, 'Продукты', '2026-11-10', 'Супермаркет');

SELECT \* FROM transactions ORDER BY date DESC, id DESC;

SELECT \* FROM transactions
WHERE date >= '2026-11-01' AND date <= '2026-11-30'
ORDER BY date DESC;

SELECT category, type, ROUND(SUM(amount), 2) AS total, COUNT(\*) AS count
FROM transactions
GROUP BY category, type
ORDER BY total DESC;

SELECT
  ROUND(COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0), 2) AS income,
  ROUND(COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0), 2) AS expense,
  ROUND(COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0), 2) AS balance
FROM transactions
WHERE date >= '2026-11-01' AND date <= '2026-11-30';

UPDATE transactions SET amount = 1300, description = 'Исправлено' WHERE id = 1;

DELETE FROM transactions WHERE id = 1;
```

## Ревью кода

**Читаемость.** Код разделён на слои: `db.js` (данные), `server.js` (HTTP и валидация), `app.js` (интерфейс). Функции короткие и названы по действию, магические значения вынесены в константы.

**Семантика.** Используются `header`, `main`, `section`, `form`, `fieldset/legend`, таблица с `caption` и `th scope`, список определений `dl` для сводки, `time\[datetime]` для дат, нативный `<dialog>`.

**Доступность.** Ссылка «Перейти к содержимому», у всех полей есть `label`, табы по паттерну ARIA с управлением стрелками, уникальные `aria-label` у кнопок в таблице, уведомления в `role="status"` и `role="alert"`, видимый `:focus-visible`, цели касания не менее 44 px. Тип операции передаётся не только цветом, но и знаком «+/−». Поддержаны `prefers-color-scheme` и `prefers-reduced-motion`.

**Безопасность.** Все SQL-запросы параметризованы, пользовательские данные выводятся через `textContent` (без `innerHTML`), размер тела запроса ограничен.

**Производительность.** Индексы по `date` и `(type, date)`, суммы и группировка считаются в SQL, список и сводка загружаются параллельно, устаревшие ответы отбрасываются, внешних библиотек и шрифтов нет, диаграмма на чистом CSS.

**Что можно улучшить.** Хранить суммы в копейках целыми числами, добавить пагинацию и автотесты.

