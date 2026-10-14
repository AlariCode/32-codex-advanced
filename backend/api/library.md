# Личная библиотека: сохранение ссылки

Все маршруты требуют существующую HttpOnly cookie `linkbook_session` из входа.
Владелец определяется сервером по хешу токена и неизёкшей сессии. Все ответы,
включая ошибки авторизации, получают `Cache-Control: no-store`.

| Маршрут               | Контракт                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users/me`   | Публичные `id`, `email`, `created_at`; без сессии — 401                                                                                                                           |
| `POST /api/links`     | JSON `{ "url": "http://example.com/article" }`; 201 и `{link, created: true, server_time}` после commit; нормализованный дубликат — 200, `created: false` и существующая карточка |
| `GET /api/links`      | `{links: [], next_cursor: "", server_time}`; `limit` 1–100 (по умолчанию 20); следующий запрос передаёт непрозрачный `cursor`                                                     |
| `GET /api/links/{id}` | Метаданные своей карточки; чужой/отсутствующий UUID — одинаковый 404                                                                                                              |

Карточка содержит `id`, `submitted_url`, nullable `title`/`reason`, `warnings`,
`state`, `generation`, `created_at`, `requested_at`, `deadline_at`, `can_read`.
В этой задаче новая карточка остаётся `processing`: worker, polling и читалка
реализуются отдельно. Внутренние fetch URL, ключ дедупликации и execution token
в ответ не входят.

## Origin и proxy

API по-прежнему слушает только `127.0.0.1`. Next.js использует явные rewrites
с серверным `API_ORIGIN` для четырёх новых маршрутов. POST требует Origin,
точно совпадающий с серверным `PUBLIC_ORIGIN` (по умолчанию
`http://localhost:3000`), и loopback-подключение. Для другого публичного адреса,
включая `http://127.0.0.1:3000`, задайте соответствующий `PUBLIC_ORIGIN` API.
При HTTPS-развёртывании задайте полный HTTPS origin без завершающего `/`.
Пользовательские Host/X-Forwarded-Host/X-Forwarded-Proto не определяют
разрешённый origin. Cookie сохраняет HttpOnly, Secure и SameSite=Lax.

## Сохранение и очередь

`submitted_url` — исходный адрес без внешних пробелов; `fetch_url` сохраняет
исходную схему и query, исключая fragment. `dedup_key` рассчитывается существующей
`NormalizeURL` без изменений её правил. URL с userinfo, пробелами/обратными слешами,
невалидным UTF-8 или длиной более 64 KiB отклоняются; тело POST ограничено 128 KiB.
Нормализатор не служит защитой загрузки: SSRF-проверки относятся к будущему worker.

Транзакция блокирует группу `(user_id, SHA-256 ключа)` advisory lock PostgreSQL,
сравнивает полный ключ и создаёт запись в свободном `dedup_slot` под UNIQUE
ограничением `(user_id, dedup_digest, dedup_slot)`. Это позволяет индексировать
длинные ключи и сохранять разные URL при совпадении digest. Конкурентный дубликат
возвращает ту же карточку без изменения `created_at` и дополнительного задания.

Карточка и `processing_jobs` создаются одной транзакцией. Ошибка enqueue
откатывает обе записи. После enqueue, непосредственно перед commit, единый
серверный timestamp задаёт начало попытки и deadline +120 секунд, включая
дальнейшее ожидание в очереди. Время ожидания блокировки/enqueue бюджет не
расходует; PostgreSQL не предоставляет будущий точный timestamp commit,
поэтому между установкой timestamp и commit остаётся короткий SQL-хвост.
Начальное задание — `queued`, generation 1, без lease/execution token.
Миграции предусматривают эти поля для последующего исполнения worker.

Список фильтруется по владельцу и упорядочен `(created_at DESC, id DESC)`.
Keyset cursor хранит оба значения; вставки новых записей между страницами
не сдвигают уже выбранную границу. Нет OFFSET и передачи документа/media.

## Проверки критериев issue #1

| Критерий                                                 | Проверка и ожидаемый результат                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Пустой список, мгновенная карточка, исправление и повтор | `web/tests/e2e/library.spec.ts`: карточка до задержанного ответа, локальная/API-валидация, сетевые/серверные ошибки, повтор                                                                               |
| Reload и durable-задание без worker                      | `TestLibraryIntegrationSaveReloadAndDeduplicate`: новый handler читает БД; начальная задача queued; дополнительно реальный браузерный проход                                                              |
| Последовательные/конкурентные дубликаты и владельцы      | `TestLibraryIntegrationSaveReloadAndDeduplicate`, `TestLibraryIntegrationConcurrentDuplicate`: 12 одновременных POST дают 1 карточку и 1 job; другой владелец получает отдельную запись                   |
| Откат enqueue и бюджет после медленного enqueue          | `TestLibraryIntegrationEnqueueRollbackAndCommitBudget`: SQL-trigger с ошибкой даёт 0/0 записей; задержка enqueue не отнимается от 120 секунд                                                              |
| Стабильная пагинация                                     | `TestLibraryIntegrationPagination`: timestamp ties, UUID tie-breaker, вставка между страницами, отсутствие пропусков/повторов и чужих записей                                                             |
| Длинные URL и digest-коллизия                            | `TestLibraryIntegrationLongKeysAndDigestCollision`: 12 KiB ключи; искусственное совпадение digest не подменяет полный ключ, повтор не создаёт job                                                         |
| Сессии, чужие ID, Origin и скрытие UI                    | `TestLibraryIntegrationAccessAndValidation` и Playwright: нет/неверная/истёкшая сессия, одинаковый 404, запрет cross-origin и spoofed forwarded headers, очистка UI при 401 и игнорирование позднего POST |
| Чистая установка, upgrade, restart                       | `TestLibraryMigrationsIntegrationCleanUpgradeRestart`: сохранение прежних users/user_sessions; старые миграции неизменны                                                                                  |
| Общий модуль                                             | `go.work`, `make check`, `make test`, `npm run lint` включают `backend/linkprocessing`; API вызывает его в интеграционных тестах                                                                          |

Обязательные команды из корня: `make check`, `make test`, `npm run test:e2e`,
`make build`, `make openapi`. UI-тесты моделируют ответы для управляемых UX-сбоев;
атомарность, конкуренция и миграции проверяются на настоящей PostgreSQL.
Видео всех UI-прогонов — `tmp/playwright/videos/`, временные артефакты исключены из Git.
