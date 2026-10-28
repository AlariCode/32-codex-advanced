"use client";

import { Button } from "@/shared/ui";
import { useLibraryState } from "../model/use-library-state";
import { useLibrarySync } from "../model/use-library-sync";
import { useLibraryActions } from "../model/use-library-actions";
import { DraftCard } from "./draft-card";
import { LibraryWelcome } from "./library-welcome";
import { SavedLinkCard } from "./saved-link-card";
import { SaveLinkForm } from "./save-link-form";
import styles from "./library.module.css";

export function LibraryPage() {
  const library = useLibraryState();
  useLibrarySync(library);
  const { send, retry, submit, more, openCard, editDraft } =
    useLibraryActions(library);
  const {
    historyHidden,
    user,
    status,
    serverClockRef,
    monotonicNow,
    cards,
    drafts,
    url,
    setURL,
    storageError,
    cursor,
    message,
    error,
    loadingMore,
    opening,
    retryGenerationRef,
    retrying,
    retryErrors,
    reloadRef,
    repeatRef,
  } = library;

  if (historyHidden)
    return (
      <main>
        <h1>Linkbook</h1>
        <p role="status">Проверяем вход…</p>
        {error && (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => reloadRef.current()}>Повторить</Button>
          </>
        )}
      </main>
    );

  if (status === "checking")
    return (
      <main aria-busy="true">
        <h1>Linkbook</h1>
        <p className="note" role="status">
          Проверяем вход…
        </p>
      </main>
    );

  if (status === "error")
    return (
      <main>
        <h1>Linkbook</h1>
        <p role="alert">Не удалось загрузить библиотеку.</p>
        <Button onClick={() => reloadRef.current()}>Повторить</Button>
      </main>
    );

  if (status !== "ready" || !user)
    return (
      <LibraryWelcome>
        <p className="note">Войдите, чтобы открыть личную библиотеку.</p>
      </LibraryWelcome>
    );

  return (
    <main className={styles.library}>
      <header className={styles.header}>
        <span className={styles.brand}>Linkbook</span>
        <span className={styles.account}>{user.email}</span>
      </header>
      <h1>Моя библиотека</h1>
      <p className={styles.intro}>
        Сохраните ссылку, чтобы вернуться к ней позже.
      </p>
      <SaveLinkForm url={url} onURLChange={setURL} onSubmit={submit} />
      {storageError && (
        <p role="status">
          Восстановление черновиков недоступно. Вы можете сохранять ссылки, пока
          страница открыта.
        </p>
      )}
      <p role="status" className={styles.message}>
        {message}
      </p>
      <section aria-label="Библиотека ссылок">
        {!cards.length && !drafts.length && (
          <div className={styles.empty}>
            <h2>Здесь будут ваши ссылки</h2>
            <p>Сохраните первую ссылку с помощью формы выше.</p>
          </div>
        )}
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            edit={editDraft}
            send={(id, raw) => {
              void send(id, raw);
            }}
          />
        ))}
        {/* Polling ticks and retry state updates render these existing ref snapshots. */}
        {/* eslint-disable react-hooks/refs */}
        {cards.map((card) => (
          <SavedLinkCard
            key={card.id}
            card={card}
            serverNow={
              serverClockRef.current.server +
              monotonicNow -
              serverClockRef.current.local
            }
            retryError={
              retryGenerationRef.current.get(card.id) === card.generation
                ? retryErrors[card.id]
                : undefined
            }
            retrying={!!retrying[card.id]}
            opening={opening}
            retry={retry}
            openCard={openCard}
          />
        ))}
        {/* eslint-enable react-hooks/refs */}
      </section>
      {error && (
        <div>
          <p role="alert">{error}</p>
          <Button onClick={() => repeatRef.current()}>
            Повторить загрузку
          </Button>
        </div>
      )}
      {cursor && (
        <Button
          onClick={() => {
            void more();
          }}
          disabled={loadingMore}
        >
          {loadingMore ? "Загружаем…" : "Показать ещё"}
        </Button>
      )}
    </main>
  );
}
