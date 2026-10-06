# Linkbook

Монорепозиторий приложения для хранения ссылок на статьи и последующего чтения.
Реализованы страница Next.js, HTTP API с регистрацией пользователей и проверкой
состояния, автомиграции PostgreSQL, отдельный процесс Worker и локальный pgvector.

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
  src/app/                  # Маршруты Next.js и корневой layout
  src/_pages/registration/  # FSD-слайс регистрации: ui, model, api
  src/shared/ui/            # Общие поля и кнопки с публичным API
backend/
  api/
    cmd/api/                # Запуск API
    internal/httpapi/       # HTTP-маршруты
    internal/database/      # Подключение к БД и автомиграции
    internal/user/          # Пользователь и регистрация
    docs/                   # Сгенерированные OpenAPI и Redoc
    go.mod
  worker/
    cmd/worker/             # Запуск Worker
    internal/worker/        # Каркас обработки фоновых задач
    go.mod
  migrations/               # Go-модуль со встроенными SQL-миграциями
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

API требует `DATABASE_URL`, подключается к PostgreSQL и применяет миграции перед
запуском HTTP-сервера. Если база недоступна или миграция не проходит, API завершает
запуск с ошибкой. `/healthz` проверяет доступность HTTP-процесса.
Worker пока не подключается к БД. Очередь, сохранение ссылок, парсинг статей,
генерация embeddings, семантический поиск, вход и сессии будут добавлены отдельно.

`POST /api/users/register` принимает JSON с `email` и `password`, создаёт
пользователя и возвращает `201` с `id`, нормализованным `email` и `created_at`.
Пароль — от 8 любых Unicode-символов, включая пробелы; в базе хранится хеш Argon2id.
Подробный [контракт регистрации](backend/api/registration.md).

Страница регистрации: <http://localhost:3000/register>. Форма отправляет запрос
на `/api/users/register` через серверный прокси Next.js, показывает ошибки API
и подтверждение создания аккаунта. Регистрация не создаёт сессию: вход пока
не реализован. Пароль не обрезается; длина проверяется по Unicode-кодовым точкам.
Форма и её API/валидация остаются в слайсе страницы по FSD v2.1, а общие элементы
интерфейса экспортируются через `shared/ui/index.ts`.

По умолчанию Next.js обращается к `http://127.0.0.1:8080` (или порту `API_PORT`).
Для другого адреса задайте серверную переменную `API_ORIGIN` в `web/.env.local`
или окружении процесса и перезапустите Next.js. При production-сборке задайте
тот же адрес перед `npm run build`: rewrites сохраняются при сборке.

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

Миграция `backend/migrations/001-create-users.sql` создаёт таблицу пользователей.
История и контрольные суммы миграций хранятся в `schema_migrations`.
Повторный запуск API не применяет SQL повторно; параллельные запуски защищены
блокировкой, ошибки SQL откатываются транзакцией. SQL встроен в бинарник и
не зависит от каталога запуска. Правила добавления миграций описаны в
[backend/migrations/README.md](backend/migrations/README.md).
Таблицы и размерность embeddings пока не задаются.

## Проверки и сборка

```sh
make check
make build
```

`make check` проверяет Go-пакеты, запускает `go vet`, ESLint и TypeScript.
`make build` собирает Go-бинарники в `bin/` и production-сборку Web.
После сборки Web можно запустить командой `npm start`.

## Интеграционные тесты регистрации

### Проверки интерфейса Playwright

```sh
npm ci --prefix web
cd web
npx playwright install chromium
cd ..
npm run test:e2e
```

Тесты находятся в `web/tests/e2e/` и проверяют главную и регистрацию на
мобильном, планшетном и десктопном разрешениях, а также ширины рядом с
адаптивным брейкпоинтом. Проверяются локальная валидация email, исправление
ошибок, клавиатурная навигация, состояние отправки и подтверждение регистрации.
Ответы API подменяются: эти проверки не создают аккаунты и не требуют базы.
Playwright автоматически запускает отдельный Next.js на `127.0.0.1:3100`.
Перед запуском остановите `npm run dev` для этого проекта: Next.js не допускает
два dev-процесса с одним каталогом `.next`.
Видео всех прогонов сохраняются в `tmp/playwright/videos/`, в подпапке каждого
теста; папка исключена из Git. Следующий запуск заменяет предыдущие артефакты.

### Проверки API и базы

```sh
make test-db-up
make test-integration
make test-db-down
```

Тесты используют отдельный PostgreSQL 18 на порту `15433`, базу `linkbook_test`
и реальные миграции из `backend/migrations`. Для каждого сценария создаётся
отдельная схема, которая удаляется после теста. Данные тестового контейнера
хранятся в памяти; рабочая база на порту `15432` не используется.

`make test-integration` передаёт `TEST_DATABASE_URL` из Makefile; его можно
переопределить для своей тестовой базы с именем `linkbook_test`. Прямой запуск
`go test -tags=integration` требует явно задать эту переменную. Отсутствующая
или недоступная база приводит к ошибке, тесты не пропускаются.

Тесты проверяют регистрацию через HTTP-обработчик, записи в базе и автомиграции:
повторный запуск, конкурентное применение, откат ошибок и целостность истории.
Обычный `make check` запускает тесты без тега `integration`.
Контракт описан в [backend/api/registration.md](backend/api/registration.md).

## Документация API

```sh
make openapi
```

Команда генерирует Swagger JSON/YAML и Redoc HTML в `backend/api/docs` из
аннотаций маршрутов с фиксированными версиями Swaggo и Redoc CLI.
Статическую страницу `backend/api/docs/swagger.html` можно открыть в браузере.

## Документация стека

- [Установка Next.js](https://nextjs.org/docs/app/getting-started/installation).
- [pgvector: включение расширения и работа с векторами](https://github.com/pgvector/pgvector).
