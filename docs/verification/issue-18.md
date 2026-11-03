# Проверка удаления карточки — issue #18

Дата: 2026-11-03. Объём: DELETE API, подтверждение/отмена в библиотеке,
неизвестный исход удаления, защита от поздних ответов и доступ к удалённому архиву.

## TDD и API

Сначала добавлен `TestDeleteIntegrationOwnershipAndCascade`; red на существующем
API: DELETE вернул 405 вместо ожидаемого 401. Затем добавлены маршрут, проверка
сессии/Origin и owner-scoped SQL DELETE. Дополнительные тесты не меняют существующий
worker fence или правила дедупликации.

Команда из корня (потребовался доступ за пределами sandbox к Go cache и test DB):

```sh
TEST_DATABASE_URL='postgres://linkbook_test:linkbook_test_local@127.0.0.1:15433/linkbook_test?sslmode=disable' go test -tags=integration ./backend/api/internal/httpapi -run TestDeleteIntegration -count=1
```

Результат: PASS. Два top-level теста, включая четыре state subtests:

- `TestDeleteIntegrationOwnershipAndCascade`: processing/ready/unavailable/failed,
  401/403 без мутации, invalid UUID 400, одинаковые foreign/missing 404 body,
  no-store; реальный snapshot и PNG доступны до удаления и недоступны после.
  Счётчики links/jobs/snapshots/assets равны нулю. Deferred failure на удалении
  assets откатывает весь готовый архив и задания; последующий DELETE успешен.
- `TestDeleteIntegrationRollbackAndExecutionFence`: ошибка deferred commit оставляет
  link/job; повтор удаляет их, старый execution не публикуется. Повтор того же URL
  создаёт новый ID.

## Визуальная проверка и UX

До написания Playwright spec изменённый UI открыт в Chromium на production-сборке:
375×812, 768×1024, 1440×900. Проверены переносы, отступы, подтверждение, pending,
ошибка с повтором, отсутствие горизонтального overflow. Все девять screenshots
просмотрены через view_image:

- `tmp/delete-confirm-{375,768,1440}.png`
- `tmp/delete-pending-{375,768,1440}.png`
- `tmp/delete-error-{375,768,1440}.png`

Затем проведено UX-ревью `ui-ux-pro-max`: подтверждение необратимого действия,
явная отмена, безопасный начальный focus на отмене, Escape, видимый keyboard focus,
44px controls, текстовая обратная связь pending/error/success. Исправлен возврат
фокуса после удаления на поле URL; cancel/success focus проверены Playwright.
Проблем вёрстки не обнаружено. Брейкпоинты не менялись.

## Mock Playwright

```sh
npm run test:e2e --prefix web -- delete.spec.ts
```

Результат: **45 passed (30.5s)** — 15 сценариев × 3 разрешения. Покрыты отмена и
подтверждение во всех состояниях, отсутствие оптимистического скрытия, запрет
двойного DELETE, ошибка до commit и повтор, потерянный ответ, DELETE 404 со свежей
metadata сверкой (`fetch cache: no-store`), ответы сверки 200/500/401,
поздние list/status/retry/duplicate-save ответы и исключение ID из polling,
401 с безопасным login returnTo. Первые прогоны выявили ошибки тестовых локаторов
Next route announcer и instrumentation cache; они исправлены, итоговый прогон зелёный.

Видео всех 45 тестов: `tmp/playwright/videos/ui/delete-*/video.webm`.

## Real Playwright

```sh
npm run test:e2e:integration --prefix web -- delete.spec.ts
```

Результат: **6 passed (23.3s)** — 2 сценария × 3 разрешения, настоящие API,
PostgreSQL и worker в отдельной схеме штатного harness:

- Готовая статья с тремя изображениями: удаление в библиотеке, links/jobs = 0,
  metadata/document/старый media URL возвращают 404 no-store; возврат во вторую
  вкладку читалки закрывает приватное содержимое и предлагает библиотеку.
  Повторное сохранение URL создаёт новую карточку с другим ID.
- Processing: серверный DELETE commit выполнен через route.fetch, ответ браузеру
  намеренно потерян; свежий GET подтверждает отсутствие, карточка исчезает,
  links/jobs = 0, reload показывает пустую библиотеку.

Видео: `tmp/playwright/videos/integration/delete-*/video.webm` и дополнительные
видеофайлы второй вкладки в тех же каталогах. Reader screenshots:
`tmp/playwright/videos/integration/delete-*/reader-deleted.png`.

## Дополнительные выполненные проверки

- `npm run typecheck --prefix web` — PASS.
- `npm run lint --prefix web` — PASS, без предупреждений.
- `API_ORIGIN=http://127.0.0.1:18081 npm run build --prefix web` — PASS;
  production runner также успешно собирал Web перед mock тестами.

## Полные проверки дирижёра

После targeted проверки дирижёр выполнил:

- `make check` — PASS после запуска с разрешённым выходом из sandbox.
- `make test` — PASS, включая все Go integration тесты.
- `make build` — PASS.
- `make openapi` — PASS; штатно обновлены четыре generated файла:
  `backend/api/docs/docs.go`, `swagger.json`, `swagger.yaml`, `swagger.html`.
- Полный `npm run test:e2e` — **318/318 PASS (2.9m)**.

Один раунд независимого статического review завершён: замечаний P0–P1 нет.
Детали замечаний P2–P3 отражаются отдельно в итоговой сводке дирижёра.

Полный `npm run test:e2e:integration` — **97/97 PASS (12.8m)**, включая
четыре recovery сценария. Приведённый выше PASS 6/6 отдельно фиксирует targeted
delete spec.

Undo, новые worker races, изменение семантики дедупликации и полный объём фазы 4
(benchmark, backup/restore, наблюдаемость) не входят в issue #18.
