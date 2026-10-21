# #9 — архив изображений

Соответствие критериев до реализации:

| Критерий                  | Проверка и ожидаемый результат                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Миграции                  | TestAssetsMigrationsIntegrationCleanUpgradeRestart: новая/существующая схема и повторный запуск                                                                                |
| Приватность и MIME        | TestAssetsIntegrationPublicationAndAccess: 401, чужой/неопубликованный/неупомянутый asset 404; bytes, MIME, nosniff, no-store                                                  |
| Сетевая политика          | TestImageFetchUsesDestinationPolicyAndByteLimit плюс существующие тесты safehttp: единая проверка каждого соединения и redirect                                                |
| Кодеки, размеры, анимация | TestImageCodecsAndLimits: настоящие PNG/JPEG/GIF bytes, битые/неподдерживаемые данные, размеры, пиксели, анимация                                                              |
| 5/20 MiB и 50 позиций     | TestArchiveImageBudgetsAndPlaceholders: каждый предел отдельно, явная причина на месте пропуска                                                                                |
| Извлечение                | TestArticleImagePositionAndCaption: alt, caption и позиции, относительный src остаётся placeholder                                                                             |
| Атомарность               | TestAssetsIntegrationPublicationAndAccess: token/generation/lease/deadline/commit rollback без промежуточных assets                                                            |
| Читалка                   | Сценарий: сохранить images fixture, дождаться ready, остановить источник, reload; текст/подписи/bytes доступны; внешних запросов статьи и исполнения payload нет, 375/768/1440 |

В этой итерации разрешён только `make check`. SQL и браузерные сценарии
добавляются для внешнего запуска; не считать их выполненными. Предыдущие
визуальные проверки приняты по указанию пользователя.

Контракт, поддержанные кодеки и технические пределы:
[image-archive.md](image-archive.md). Сквозные fixtures normal/single/total/count/
invalid доступны через integration harness. Добавлены UI-регрессии ошибок
asset и отказа внешнего asset_id. Новые браузерные сценарии не запускались.
