"use client";

import {
  ActionLink,
  Button,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
} from "@/shared/ui";
import { useLibraryState } from "../model/use-library-state";
import { useLibrarySync } from "../model/use-library-sync";
import { useLibraryActions } from "../model/use-library-actions";
import { useLibraryDelete } from "../model/use-library-delete";
import { DraftCard } from "./draft-card";
import { LibraryWelcome } from "./library-welcome";
import { SavedLinkCard } from "./saved-link-card";
import { SaveLinkForm } from "./save-link-form";
import styles from "./library.module.css";

export function LibraryPage() {
  const library = useLibraryState();
  useLibrarySync(library);
  const remove = useLibraryDelete(library);
  const { send, retry, submit, more, openCard, editDraft } =
    useLibraryActions(library);
  const {
    deleting,
    deleteErrors,
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

  if (historyHidden || status === "checking" || status === "error") {
    const initialError = historyHidden
      ? error
      : status === "error"
        ? "Не удалось загрузить библиотеку."
        : "";
    return (
      <PageFrame className={styles.library}>
        <PageHeader />
        <h1>Linkbook</h1>
        <div className={styles.loadError}>
          {(historyHidden || status === "checking") && (
            <Notice tone="neutral" role="status">
              Проверяем вход…
            </Notice>
          )}
          {initialError && (
            <>
              <Notice tone="danger" role="alert">
                {initialError}
              </Notice>
              <Button variant="secondary" onClick={() => reloadRef.current()}>
                Повторить
              </Button>
            </>
          )}
        </div>
      </PageFrame>
    );
  }

  if (status !== "ready" || !user) return <LibraryWelcome />;

  return (
    <PageFrame className={styles.library}>
      <PageHeader>
        <ActionLink
          href="/profile"
          className={styles.account}
          aria-label={`Профиль: ${user.email}`}
        >
          {user.email}
        </ActionLink>
      </PageHeader>
      <h1>Моя библиотека</h1>
      <p className={styles.intro}>
        Сохраните ссылку, чтобы вернуться к ней позже.
      </p>
      <div className={styles.savePanel}>
        <SaveLinkForm url={url} onURLChange={setURL} onSubmit={submit} />
      </div>
      <div className={styles.feedback}>
        {storageError && (
          <Notice tone="warning" role="status">
            Восстановление черновиков недоступно. Вы можете сохранять ссылки,
            пока страница открыта.
          </Notice>
        )}
        {message && (
          <Notice tone="success" role="status">
            {message}
          </Notice>
        )}
      </div>
      <section className={styles.collection} aria-label="Библиотека ссылок">
        {!cards.length && !drafts.length && (
          <EmptyState title="Здесь будут ваши ссылки">
            Сохраните первую ссылку с помощью формы выше.
          </EmptyState>
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
            deleting={!!deleting[card.id]}
            deleteError={deleteErrors[card.id]}
            remove={remove}
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
        <div className={styles.loadError}>
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          <Button variant="secondary" onClick={() => repeatRef.current()}>
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
          aria-busy={loadingMore}
          variant="text"
          className={styles.pagination}
        >
          {loadingMore ? "Загружаем…" : "Показать ещё"}
        </Button>
      )}
    </PageFrame>
  );
}
