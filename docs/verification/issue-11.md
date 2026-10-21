# #11 — Недоступная статья и ручной повтор

## Критерии и проверка

| Критерий                                                  | Тест / ожидаемый результат                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Позитивные статьи остаются ready                          | Существующие extract/worker unit-тесты форматирования, кода, изображений и частичных результатов не изменены и проходят в make check                                                                                                                                                                                                                                                |
| Главная, PDF, видео, login/paywall, JS-only — unavailable | TestUnavailableClassesAndTitleFallback, TestAccessGatesDoNotBecomeReadablePreviews, TestVideoAndHomepageCannotUseDescriptionsAsArticle, TestNonArticleHTTPAndNetworkClassification: нет Document, reason article_unavailable; сеть — network_error, HTTP 404 — http_error; parser/resource failures сохраняют processing_error                                                      |
| Заголовок и безопасный оригинал                           | Extracted title проверяет существующий TestArticleUsesReadeckAndOnlyPublishesKnownTextBlocks; новые тесты проверяют metadata и hostname, TestTerminalCardTitleFallback покрывает ready/unavailable/failed, включая timeout без worker. API URL валидируется до сохранения, UI DTO использует validURL; e2e проверяет href/rel                                                       |
| Сессия, owner, Origin/CSRF, исходный статус               | TestRetryIntegrationAtomicConcurrentAndFenced: 401 без сессии, 403 без/с чужим Origin, 404 чужого владельца, 409 processing, 400 generation=0; ready отвергается TestRetryIntegrationSameCardBecomesReady                                                                                                                                                                           |
| Атомарность, одна активная попытка, потерянный ответ      | 8 конкурентных POST дают generation=2 и только 2 исторических jobs/1 active. Replay generation=1 после завершения generation=2 возвращает текущую карточку без enqueue. Ошибка INSERT trigger возвращает 500 и откатывает generation/state                                                                                                                                          |
| Fence старой generation/execution                         | Старый running execution не может Publish после Retry; используются существующие fences Claim/Publish/Renew. Поздние polling/get-ответы generation=1 в e2e не заменяют generation=2 и не останавливают её polling                                                                                                                                                                   |
| Новый бюджет и ожидание                                   | TestRetryIntegrationBudgetIncludesQueueAndRejectsExpiredPublish: новый requested_at/deadline, ровно 120 s, processing после 31 s, отказ поздней публикации и timeout. Существующие recovery-тесты проверяют expiry queued jobs. Управляемый e2e clock проверяет сообщение после 30 s и отсутствие выдуманного timeout без ответа сервера; запоздалый server_time не откатывает часы |
| Та же карточка, ready, reader                             | TestRetryIntegrationSameCardBecomesReady: обе исходные ошибки → processing → ready/document, ID/created_at прежние; сортировка mergeCards и SQL list по created_at не меняется. Integration e2e retry.spec.ts исправляет каждый fixture на настоящую статью, нажимает кнопку и читает архив через proxy/API/worker                                                                  |
| Ошибка запроса без фиктивного processing                  | E2E lost retry response: понятная ошибка в карточке, processing не появляется, повторный POST использует прежнюю generation                                                                                                                                                                                                                                                         |
| Контракты/proxy                                           | HTTP route + Next rewrite /api/links/:id/retry, DTO request/response, Swagger JSON/YAML/Go и embedded HTML spec синхронизированы локально                                                                                                                                                                                                                                           |

## Принятые решения и сценарии UI

- POST принимает обязательный JSON `{ "generation": N }`. N — поколение,
  которое пользователь повторяет, а не новое поколение. При N меньше текущего
  возвращается текущая карточка без enqueue, даже если она уже terminal.
  Так потеря ответа не превращается в повторную обработку уже новой ошибки.
  Для явного нового повтора UI отправляет generation показанного результата.
- Для совпадающего N допустимы только failed/unavailable; processing/ready
  возвращают 409 и не создают job. Replay исходного запроса к processing
  новой generation возвращает 200. Это уточнение контракта сохраняет критерий
  «недопустимый исходный статус не создаёт попытку».
- Карточка блокирует кнопку только на время HTTP-запроса и показывает
  «Отправляем повтор…». Processing показывается только после подтверждения
  сервера. Ошибка рядом с кнопкой имеет role=alert. Оригинал доступен,
  читалка появляется только у ready. Порядок библиотеки сохраняется.
- Используются текущие row lock, generation/token/lease/deadline fences,
  UNIQUE(link_id,generation). Retry отменяет оставшиеся active jobs и меняет
  карточку вместе с enqueue одной транзакцией. Новая миграция не нужна.
- PostgreSQL clock_timestamp устанавливается после блокировок и INSERT,
  непосредственно перед commit, как в initial save. Точный будущий timestamp
  commit PostgreSQL не предоставляет; остаётся короткий SQL-хвост до commit.
  Очередь после фиксации расходует бюджет.
- Классификация консервативная: явные password gates в области основного содержимого, public metadata
  isAccessibleForFree=false и HTTP 401/402/403 не обходятся. Видео без
  article и коллекции нескольких article со ссылками в заголовках отклоняются.
  Без declared article требуется минимум 200 bytes текста абзацев. Это
  эвристика статической страницы, не универсальное распознавание всех сайтов.
  Один объём текста не является единственным основанием классификации.
- Общая причина article_unavailable объясняется в UI перечислением возможных
  классов. Отдельные коды причин по каждому классу не вводятся. Неподдерживаемая
  transfer encoding остаётся техническим unsupported_content/failed.

## Выполнение проверок

Новые extract/worker unit-тесты сначала воспроизвели RED на старой реализации.
Дополнительные RED-регрессии выявили обход через длинный gated preview,
описание видео/анонсы и отсутствие hostname у timeout без worker.
Существующий тест многочастной статьи выявил слишком широкую классификацию
collection: исправлен продуктовый код, тест не менялся. Assertions зафиксированных
серверных тестов не ослаблялись. SQL-тесты написаны до реализации Retry,
но их RED/green запуск здесь недоступен по прямому запрету пользователя.

`make check` запускается из корня: Go unit tests/vet, ESLint, TypeScript.
Локальные httptest порты потребовали разрешённого sandbox-запуска той же команды.
Предыдущие визуальные проверки приняты по указанию пользователя.
Новые браузерные проверки, Playwright, UX-проход и видео здесь не запускались.
Написанные e2e используют существующие проекты 375/768/1440 и video:on;
результаты и видео пока не получены. make test, make build и make openapi
не запускались по ограничениям. SQL/e2e/сборку/регенерацию выполняет внешний
скрипт; успешный make check их не заменяет.

## Исправления после ревью

- TestAvailableArticleIgnoresUnrelatedLoginAndEmbeddedFrames проверяет
  положительные статьи в article/main/div с отдельной формой аккаунта,
  header-формой и iframe. TestAvailableMainArticleWithEmbeddedIframeAndAccountHeader
  дополнительно проверяет iframe и header внутри main. Все они сохраняют
  Document и полный основной абзац; прежние отрицательные gated-preview,
  metadata-paywall и video/коллекции остаются обязательными.
- Password gate привязан к области основного текста (article/main над
  наиболее содержательным абзацем либо контейнер этого абзаца). Обычные формы вне
  области и элементы header/nav/aside/footer не определяют доступность статьи.
  Явные инструкции формы о входе для чтения проверяются также у соседней формы
  и её непосредственного контейнера: расположение рядом с preview не отменяет gate.
  Любой iframe больше не считается доказательством видео-страницы; сам он
  по-прежнему удаляется из архива, его URL не загружается. Явные paywall
  declarations и HTTP-классификация не изменены.
- Mock e2e для failed и unavailable: POST generation=1 теряет ответ,
  «Открыть карточку» подтверждает terminal generation=2, ошибка старого
  запроса исчезает; следующий явный retry отправляет generation=2.
  Отдельный сценарий подтверждает processing generation=2 через GET и
  проверяет возобновление polling до ready. Старые ответы не отменяют
  generation новой активной попытки.
- Реальный integration e2e выполняет POST через route.fetch, проверяет
  generation=2 в ответе сервера и теряет только браузерный ответ. После
  завершения с network_error подтверждает generation через кнопку,
  исправляет источник и получает ready generation=3 в той же карточке.
- Каждый integration-сценарий отрицательного класса теперь сохраняет ещё
  две карточки. Массивы ID из API и порядок DOM сверяются до и после retry:
  исходная карточка остаётся третьей, ID/created_at не меняются.

Новые серверные позитивные регрессии сначала дали ожидаемый RED;
после исправления классификатора make check прошёл. Новые e2e написаны,
но здесь не запускались по ограничениям пользователя; их выполняет раннер.

## Уточнение классификации media и обязательного входа

- TestPublicMainNarrativeWithEmbeddedVideoStaysReadable: main с письменным
  заголовком и основным текстом остаётся читаемой статьёй при video до,
  между или после абзацев; проверяются полный основной текст и заключение.
- Video не блокирует письменную статью только из-за отсутствия тега article.
  Для main/обычного контейнера свидетельством письменной статьи служат
  заголовок h1/h2 и минимум 200 bytes текста абзацев. Голый player/описание
  без такого свидетельства остаётся unavailable. Явный og:type=video/video.*
  обозначает видео-страницу; TestDeclaredVideoPageDoesNotArchiveItsLongDescription
  сохраняет unavailable даже при заголовке и длинном описании.
- TestMandatorySiblingLoginGatesBlockArticlePreview: шесть случаев обязательного
  входа до/после article-preview дают unavailable без Document. Проверяются
  инструкции внутри формы, aria-label её контейнера и русская email-only форма.
  Для распознавания обязательности читаются текст/подписи формы и непосредственные
  инструкции соседних h1/h2/h3/p/label/legend; текст самого article/main и scripts
  не используются как инструкции формы. Generic account/password-формы из прежних
  позитивных регрессий остаются допустимыми. Внутренние gate и metadata paywall
  продолжают проверяться независимо от нового правила.

Это ограниченные эвристики статического HTML и явных инструкций на английском/
русском; они не доказывают доступность произвольного сайта. Никаких новых
запросов источнику, проигрывания media, исполнения JS или обхода авторизации
не добавлено. Новые unit-регрессии прошли RED перед правкой продуктового кода.

## Закрытие последнего замечания ревью: статья с рекомендацией

`TestPublicArticleWithLinkedSubheadingAndRecommendationStaysReadable`
проверяет полный основной текст и заключение публичной статьи со ссылкой
в последующем h1/h2/h3 и рекомендацией до, после либо внутри статьи.
До исправления шесть случаев с отдельной рекомендацией давали
`article_unavailable`; после исправления все девять сохраняют Document.

Признак анонса теперь проверяется только в первом собственном заголовке
article до существенного основного текста (абзац не менее 200 bytes). Ссылки в последующих разделах и заголовки вложенных article
не определяют заголовок основного материала. Настоящая коллекция анонсов
с первыми заголовками-ссылками по-прежнему unavailable; прежние негативные
тесты, включая login/paywall, видео и JS-only, сохранены без ослабления.
Это ограниченная структурная эвристика, а не универсальный детектор главных
страниц; объём текста сам по себе не отменяет отрицательную классификацию.

Playwright-селекторы ошибок в formatting-reader, image-reader и retry
ограничены областью main: служебный route-announcer Next.js вне main также
имеет роль alert. Ожидаемые тексты, отсутствие опасного содержимого и
исчезновение ошибок после подтверждения retry проверяются без изменения.

В integration retry чтение приватных DTO выполняется через браузерный fetch:
Chromium отправляет Secure session-cookie по loopback HTTP, тогда как
APIRequestContext её не отправляет. Раньше прямые page.request.get возвращали
401 и тесты падали до retry. authenticatedJSON требует успешный HTTP-ответ;
все проверки ID/created_at, generation, бюджета и порядка сохранены.
Cookie остаётся Secure; API и схема авторизации не изменены.

`TestPublicArticleWithProseBeforeLinkedHeadingAndRecommendationStaysReadable`
покрывает статью без начального заголовка: основной текст, затем подзаголовок
со ссылкой и отдельная рекомендация. Новый тест тоже подтвердил RED до правки;
первый заголовок после существенного текста считается разделом, не анонсом.
Проверяются полный основной абзац и заключение, а не только наличие Document.

## Проверки при завершении исправления

make check, make test, make build и make openapi прошли. UI-набор: 162 + 27
успешных сценариев после исправления alert-селекторов. Полный integration:
49 прошли; 24 retry выявили проблему APIRequestContext, исправленную браузерным
fetch. Повтор integration остановлен при высокой нагрузке хоста (load average
77.15), нестабильных UI-таймаутах и ошибках ожидания SQL: 7 passed, 5 failed,
1 interrupted, 11 did not run. Полностью зелёный integration не подтверждён;
его нужно повторить при нормальной нагрузке. Подробности и пути артефактов
записаны в docs/ralph/progress.md.
