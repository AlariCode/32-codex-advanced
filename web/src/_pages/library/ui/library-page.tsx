"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UserDTO } from "@/shared/api";
import { Button, TextField } from "@/shared/ui";
import {
  currentUser,
  getLink,
  LibraryError,
  listLinks,
  saveLink,
} from "../api/library";
import {
  mergeCards,
  validURL,
  type Draft,
  type LinkCard,
} from "../model/library";
import styles from "./library.module.css";

function Welcome({ children }: { children?: React.ReactNode }) {
  return (
    <main>
      <h1>Linkbook</h1>
      <p>Сохраняйте статьи, чтобы вернуться к ним позже.</p>
      <Link href="/register" className="registration-link">
        Создать аккаунт <span aria-hidden="true">→</span>
      </Link>
      <p>
        <Link href="/login" className="login-link">
          Уже есть аккаунт? Войти <span aria-hidden="true">→</span>
        </Link>
      </p>
      {children}
    </main>
  );
}
function DraftCard({
  draft,
  send,
}: {
  draft: Draft;
  send: (id: string, url: string) => void;
}) {
  const [url, setURL] = useState(draft.url);
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
              onChange={(event) => setURL(event.target.value)}
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

export function LibraryPage() {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [status, setStatus] = useState<
    "checking" | "anonymous" | "ready" | "error"
  >("checking");
  const [cards, setCards] = useState<LinkCard[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [url, setURL] = useState("");
  const [cursor, setCursor] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const scope = useRef(new AbortController());
  const busy = useRef(new Set<string>());
  const moreBusy = useRef(false);
  const openBusy = useRef(false);
  const focusCard = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCard.current) return;
    const element = document.getElementById(`link-${focusCard.current}`);
    if (element) {
      element.focus();
      element.scrollIntoView({ block: "nearest", behavior: "instant" });
      focusCard.current = null;
    }
  }, [cards]);
  const reload = useRef<() => void>(() => {});

  function invalidate() {
    scope.current.abort();
    focusCard.current = null;
    busy.current.clear();
    moreBusy.current = false;
    openBusy.current = false;
    setUser(null);
    setCards([]);
    setDrafts([]);
    setURL("");
    setCursor("");
    setMessage("");
    setError("");
    setLoadingMore(false);
    setOpening(null);
    setStatus("anonymous");
  }
  function unauthorized(error: unknown) {
    if (error instanceof LibraryError && error.status === 401) {
      invalidate();
      return true;
    }
    return false;
  }
  useEffect(() => {
    async function load() {
      scope.current.abort();
      focusCard.current = null;
      const controller = new AbortController();
      scope.current = controller;
      busy.current.clear();
      moreBusy.current = false;
      openBusy.current = false;
      setStatus("checking");
      setUser(null);
      setCards([]);
      setDrafts([]);
      setURL("");
      setCursor("");
      setError("");
      setMessage("");
      setLoadingMore(false);
      setOpening(null);
      try {
        const identity = await currentUser(controller.signal);
        const page = await listLinks(controller.signal);
        if (controller.signal.aborted) return;
        setUser(identity);
        setCards(page.links);
        setCursor(page.next_cursor);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(
          error instanceof LibraryError && error.status === 401
            ? "anonymous"
            : "error",
        );
      }
    }
    reload.current = () => {
      void load();
    };
    void load();
    const restore = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    return () => {
      scope.current.abort();
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
    };
  }, []);

  async function send(id: string, raw: string) {
    if (busy.current.has(id)) return;
    const normalized = raw.trim();
    const draft: Draft = {
      id,
      url: normalized,
      state: validURL(normalized) ? "sending" : "invalid",
    };
    setDrafts((current) => [
      draft,
      ...current.filter((item) => item.id !== id),
    ]);
    setMessage("");
    if (draft.state === "invalid") return;
    busy.current.add(id);
    const controller = scope.current;
    try {
      const result = await saveLink(controller.signal, normalized);
      if (controller.signal.aborted) return;
      focusCard.current = result.link.id;
      setCards((current) => mergeCards(current, [result.link]));
      setDrafts((current) => current.filter((item) => item.id !== id));
      setMessage(result.created ? "Ссылка сохранена" : "Ссылка уже сохранена");
    } catch (error) {
      if (controller.signal.aborted || unauthorized(error)) return;
      setDrafts((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                state:
                  error instanceof LibraryError && error.code === "invalid_url"
                    ? "invalid"
                    : "error",
              }
            : item,
        ),
      );
    } finally {
      if (scope.current === controller) busy.current.delete(id);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void send(crypto.randomUUID(), url);
    setURL("");
  }
  async function more() {
    if (moreBusy.current) return;
    moreBusy.current = true;
    setLoadingMore(true);
    setError("");
    const controller = scope.current;
    try {
      const page = await listLinks(controller.signal, cursor);
      if (!controller.signal.aborted) {
        setCards((current) => mergeCards(current, page.links));
        setCursor(page.next_cursor);
      }
    } catch (error) {
      if (!controller.signal.aborted && !unauthorized(error))
        setError("Не удалось загрузить ссылки. Попробуйте ещё раз.");
    } finally {
      if (scope.current === controller) {
        moreBusy.current = false;
        setLoadingMore(false);
      }
    }
  }
  async function openCard(id: string) {
    if (openBusy.current) return;
    openBusy.current = true;
    setOpening(id);
    setError("");
    const controller = scope.current;
    try {
      const card = await getLink(controller.signal, id);
      if (!controller.signal.aborted) {
        focusCard.current = id;
        setCards((current) => mergeCards(current, [card]));
      }
    } catch (error) {
      if (!controller.signal.aborted && !unauthorized(error))
        setError("Не удалось открыть карточку. Попробуйте ещё раз.");
    } finally {
      if (scope.current === controller) {
        openBusy.current = false;
        setOpening(null);
      }
    }
  }

  if (status !== "ready" || !user)
    return (
      <Welcome>
        {status === "checking" && (
          <p className="note" role="status">
            Проверяем вход…
          </p>
        )}
        {status === "anonymous" && (
          <p className="note">Войдите, чтобы открыть личную библиотеку.</p>
        )}
        {status === "error" && (
          <div>
            <p role="alert">Не удалось загрузить библиотеку.</p>
            <Button onClick={() => reload.current()}>Повторить</Button>
          </div>
        )}
      </Welcome>
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
      <form onSubmit={submit} noValidate className={styles.saveForm}>
        <TextField
          id="library-url"
          label="Ссылка на статью"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://example.com/article"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          hint="Адрес с http:// или https://"
        />
        <Button type="submit">
          Сохранить ссылку <span aria-hidden="true">↗</span>
        </Button>
      </form>
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
            send={(id, raw) => {
              void send(id, raw);
            }}
          />
        ))}
        {cards.map((card) => (
          <article
            key={card.id}
            id={`link-${card.id}`}
            tabIndex={-1}
            className={styles.card}
            aria-label={`Сохранённая ссылка ${card.submitted_url}`}
          >
            <p className={styles.eyebrow}>
              {
                {
                  processing: "Обрабатываем",
                  ready: "Готово",
                  unavailable: "Текст статьи недоступен",
                  failed: "Ошибка обработки",
                }[card.state]
              }
            </p>
            {card.title && <h2>{card.title}</h2>}
            <p className={styles.address}>{card.submitted_url}</p>
            <div className={styles.actions}>
              <button
                disabled={opening !== null}
                onClick={() => {
                  void openCard(card.id);
                }}
              >
                {opening === card.id ? "Открываем…" : "Открыть карточку"}
              </button>
              <a
                href={card.submitted_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть оригинал <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        ))}
      </section>
      {error && <p role="alert">{error}</p>}
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
