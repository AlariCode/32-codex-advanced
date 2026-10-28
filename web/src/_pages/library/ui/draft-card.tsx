import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui";
import type { Draft } from "../model/library";
import styles from "./library.module.css";

export function DraftCard({
  draft,
  send,
  edit,
}: {
  draft: Draft;
  send: (id: string, url: string) => void;
  edit: (id: string, url: string) => void;
}) {
  const url = draft.url;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (draft.state !== "sending") input.current?.focus();
  }, [draft.state]);
  return (
    <article
      className={styles.draft}
      aria-label="Предварительная карточка"
      aria-busy={draft.state === "sending"}
    >
      <p className={styles.eyebrow}>Ещё не сохранено</p>
      <p className={styles.address}>{draft.url || "Пустой адрес"}</p>
      {draft.state === "sending" ? (
        <p role="status">Сохраняем ссылку…</p>
      ) : (
        <>
          <p id={`draft-${draft.id}-error`} role="alert">
            {draft.state === "invalid"
              ? "Проверьте адрес. Нужна ссылка с http:// или https:// без логина и пароля."
              : draft.state === "unknown"
                ? "Исход отправки неизвестен. Повторите отправку для подтверждения сохранения."
                : "Не удалось подтвердить сохранение. Повторите отправку."}
          </p>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              send(draft.id, url);
            }}
          >
            <label htmlFor={`draft-${draft.id}`}>Исправить URL</label>
            <input
              ref={input}
              id={`draft-${draft.id}`}
              value={url}
              onChange={(event) => edit(draft.id, event.target.value)}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={draft.state === "invalid"}
              aria-describedby={`draft-${draft.id}-error`}
            />
            <Button type="submit">
              {draft.state === "invalid"
                ? "Сохранить исправленный адрес"
                : "Повторить отправку"}
            </Button>
          </form>
        </>
      )}
    </article>
  );
}
