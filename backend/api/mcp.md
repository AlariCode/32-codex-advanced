# MCP API

`/mcp` — официальный Go SDK v1.8.0, Streamable HTTP, `Stateless: true`,
`JSONResponse: true`. Сервер не создаёт MCP-сессию; `tools/list` и `tools/call`
работают отдельными POST-запросами без предварительного initialize.
С действительным токеном GET и DELETE возвращают 405. Accept должен содержать `application/json` и
`text/event-stream`; Content-Type — `application/json`.

## Авторизация и управление токенами

Создайте токен на сайте в `/profile` (ссылка из email в шапке библиотеки).
Секрет `lb_mcp_…` содержит 32 криптографически случайных байта. API возвращает его
только в ответе создания, в PostgreSQL хранит только SHA-256. Не сохраняйте секрет
в URL, логах или browser storage. Токен даёт полный доступ к MCP-инструментам
библиотеки владельца, действует до отзыва; можно создать несколько независимых токенов.

Каждый запрос `/mcp` требует `Authorization: Bearer <токен>`. Отсутствующий,
неверный и отозванный токены дают 401 с `WWW-Authenticate: Bearer realm="linkbook-mcp"`.
Cookie сайта не заменяет MCP-токен; MCP-токен не заменяет cookie сайта.
Проверка выполняется на каждом запросе; отзыв закрывает последующие запросы,
но уже начатый запрос может завершиться. Ошибка БД даёт 500. Ответы — `no-store`.
Маршрут всегда зарегистрирован, `MCP_DEV_USER_EMAIL` больше не используется.

Управление через сессию сайта (`linkbook_session`):

- `GET /api/users/me/mcp-tokens` → 200, массив `{id, created_at}`, без секретов/хэшей.
- `POST /api/users/me/mcp-tokens` без тела → 201, `{id, created_at, token}`; секрет только здесь.
- `DELETE /api/users/me/mcp-tokens/{id}` → 204; удаляет только свой токен.
  Повторный отзыв и чужой UUID также дают 204 без изменения чужих данных.

Без сессии — 401. POST/DELETE требуют matching `PUBLIC_ORIGIN` и loopback peer
(как остальные изменения через Next.js proxy), иначе 403; неверный UUID — 400.
Список в профиле показывает дату и короткий ID; отзыв требует подтверждения.

Любой присутствующий Origin (включая пустой, null и localhost) даёт 403
до выполнения инструмента. Ограничение тела запроса — 128 KiB.

Все инструменты — обёртки над `link.Service` от имени владельца токена.
Каждый объявляет inputSchema с описаниями полей, outputSchema и annotations.
Успех содержит `structuredContent` и тот же JSON в текстовом `content`.

| Инструмент    | Вход                                                      | Результат                             | Когда вызывать                                                                              |
| ------------- | --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `save_link`   | обязательный `url` — абсолютный HTTP(S) URL               | `id`, `url`, `created`                | Сохранить ссылку по просьбе пользователя; дубликат возвращает прежний ID и `created: false` |
| `list_links`  | необязательные `cursor`, `limit` (1–100, по умолчанию 20) | `links`, `next_cursor`, `server_time` | Просмотреть библиотеку или найти ID; для следующей страницы передать `next_cursor`          |
| `get_link`    | обязательный `id` — UUID                                  | Карточка                              | Проверить обработку, получить generation перед retry                                        |
| `retry_link`  | обязательные `id`, положительный `generation` из get_link | Карточка                              | Повторить failed/unavailable по просьбе пользователя                                        |
| `delete_link` | обязательный `id` — UUID                                  | `id`, `deleted: true`                 | Безвозвратно удалить ссылку, архив и задания по просьбе пользователя                        |

Карточка содержит поля `link.Card`: `id`, `submitted_url`, `title`, `state`,
`generation`, `reason`, `warnings` (массив строк), `created_at`, `requested_at`,
`deadline_at`, `can_read`, а также `resource_uri: linkbook://links/<id>`.
`links` отсортированы от новых к старым; пустой `next_cursor` означает конец.

`list_links` и `get_link` имеют `readOnlyHint: true`. Save и retry имеют
`destructiveHint: false`; delete — `true`. Все инструменты объявляют
`openWorldHint: false`: они работают с библиотекой, загрузку выполняет Worker.
Save, retry и delete объявляют `idempotentHint: true` (повторное удаление
не меняет данные, но сообщает, что ссылка уже отсутствует).
List/get могут выполнять служебный sweep просроченных заданий внутри Service,
не меняя пользовательский контент.

Retry сохраняет семантику Service: равная generation допустима для failed/unavailable,
большая или несовместимое состояние дают конфликт; меньшая возвращает текущую
карточку без нового задания. При потере ответа повторяйте исходную generation.

Неверный URL, cursor, limit, UUID, generation, отсутствующая/чужая ссылка и
конфликт retry дают HTTP 200 с `result.isError: true` и понятным текстом в content.
Ошибки инфраструктуры скрывают детали БД. Невалидный URL предлагает абсолютный
HTTP(S) URL без credentials, пробелов и обратных слешей, длиной до 64 KiB.

## Ресурс статьи

`resources/templates/list` объявляет `linkbook://links/{id}` с MIME `text/markdown`.
`resources/read` вызывает `link.Service.Document` с проверкой владельца и читает
только сохранённый документ; исходный сайт не загружается. Поддерживаются схемы
документа v1/v2: заголовки, абзацы, форматирование, ссылки, код, цитаты, списки,
таблицы; изображения представлены текстом alt без бинарных данных.
Ответ ограничен 100 KiB UTF-8, включая уведомление об обрезке в конце.
Не готовая/недоступная статья, отсутствующая/чужая ссылка возвращают понятную
JSON-RPC ошибку ресурса (у resources/read нет поля isError).

```sh
curl -sS http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $LINKBOOK_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -sS http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $LINKBOOK_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_link","arguments":{"url":"https://example.com/mcp"}}}'
```

```sh
curl -sS http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $LINKBOOK_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":3,"method":"resources/templates/list"}'

# Подставьте ID готовой статьи из list_links/get_link.
curl -sS http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $LINKBOOK_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"linkbook://links/<id>"}}'
```

Проверки: `make check`, `make test`. MCP-тесты проверяют контракты всех пяти
инструментов, annotations, пагинацию, изоляцию владельцев, retry и его повтор,
каскадное удаление, ошибки, чтение статьи, Markdown v1/v2 и UTF-8 обрезку.
