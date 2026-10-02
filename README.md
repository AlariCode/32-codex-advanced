# Linkbook

Монорепозиторий приложения для хранения ссылок на статьи и последующего чтения.
Сейчас реализован только каркас: страница Next.js, HTTP API с проверкой состояния,
отдельный процесс Worker и локальный PostgreSQL с pgvector.

## Стек

- Web: Next.js 16, React 19, TypeScript, App Router, обычный CSS, npm.
- API: Go 1.26, стандартный `net/http`.
- Worker: отдельный Go-модуль; пока ожидает завершения по SIGINT/SIGTERM.
- База: PostgreSQL 18, pgvector 0.8.6, Docker Compose.

## Структура

```text
web/
  node_modules/             # Локальные зависимости frontend (не в Git)
  package-lock.json         # Зафиксированные зависимости frontend
  src/app/                  # Страницы и корневой layout
backend/
  api/
    cmd/api/                # Запуск API
    internal/httpapi/       # HTTP-маршруты
    go.mod
  worker/
    cmd/worker/             # Запуск Worker
    internal/worker/        # Каркас обработки фоновых задач
    go.mod
  migrations/               # Место для будущих миграций общей БД
infra/postgres/init/        # Первичная настройка pgvector
compose.yaml
go.work                     # Объединяет два Go-модуля
package.json                # Команды запуска web
Makefile
.env.example
```

## Локальный запуск

Нужны Node.js 22+, npm, Go 1.26+ и запущенный Docker с Compose v2.
Все команды ниже выполняются из корня репозитория.

```sh
make setup
make db-up
```

Затем в трёх отдельных терминалах:

```sh
make web
```

```sh
make api
```

```sh
make worker
```

- Web: <http://localhost:3000>.
- API: <http://localhost:8080/healthz>, ответ `{"status":"ok"}`.
- PostgreSQL: `localhost:15432`, база и пользователь `linkbook`.

`make setup` создаёт локальный `.env` из примера и устанавливает зависимости
по lock-файлу. Make передаёт настройки `.env` Go-процессам, а Compose читает
его автоматически. Примерные учётные данные предназначены для локальной разработки.
Если изменён `POSTGRES_PORT`, обновите также `DATABASE_URL`.

API и Worker пока не подключаются к БД. `/healthz` проверяет только доступность
HTTP-процесса. Очередь, сохранение ссылок, парсинг статей, генерация embeddings,
семантический поиск и авторизация будут добавлены отдельно.

## База данных

```sh
make db-shell
```

Проверка расширения и векторной операции в psql:

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';
SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS distance;
```

Второй запрос должен вернуть `1`.

Данные сохраняются в named volume. `make db-down` останавливает базу,
сохраняя данные; `make db-logs` показывает логи. Init-скрипты запускаются
только при создании пустой базы. Для уже существующей базы расширение
можно включить вручную: `CREATE EXTENSION IF NOT EXISTS vector;`.

Таблицы и размерность embeddings пока не задаются. Миграции будут размещены
в `backend/migrations` после определения модели данных и выбора инструмента миграций.

## Проверки и сборка

```sh
make check
make build
```

`make check` проверяет Go-пакеты, запускает `go vet`, ESLint и TypeScript.
`make build` собирает Go-бинарники в `bin/` и production-сборку Web.
После сборки Web можно запустить командой `npm start`.

## Документация стека

- [Установка Next.js](https://nextjs.org/docs/app/getting-started/installation).
- [pgvector: включение расширения и работа с векторами](https://github.com/pgvector/pgvector).
