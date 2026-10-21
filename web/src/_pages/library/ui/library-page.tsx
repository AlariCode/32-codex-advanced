"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { UserDTO } from "@/shared/api";
import { Button, TextField } from "@/shared/ui";
import {
  currentUser,
  getLink,
  LibraryError,
  listLinks,
  saveLink,
  retryLink,
  statuses,
} from "../api/library";
import {
  mergeCards,
  validURL,
  type Draft,
  type LinkCard,
} from "../model/library";
import styles from "./library.module.css";

function processingReason(reason?: string | null) {
  return (
    (
      {
        article_unavailable:
          "На странице нет доступного текста статьи: это может быть главная, видео, PDF или страница входа/оплаты. Откройте оригинал или повторите позже.",
        destination_blocked: "Этот адрес недоступен для безопасной загрузки.",
        network_error: "Не удалось связаться с сайтом.",
        http_error: "Сайт не отдал страницу.",
        html_too_large: "Страница превышает допустимый размер.",
        unsupported_content: "По этому адресу нет HTML-страницы.",
        redirect_limit: "Сайт перенаправляет слишком много раз.",
        processing_error: "Не удалось обработать текст статьи.",
        timeout:
          "Не удалось обработать ссылку за две минуты. Откройте оригинал.",
      } as Record<string, string>
    )[reason ?? ""] ?? "Не удалось обработать ссылку."
  );
}

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
  const serverClock = useRef({ server: 0, local: 0 });
  const [monotonicNow, setMonotonicNow] = useState(0);
  const syncClock = useCallback((serverTime: string) => {
    const server = Date.parse(serverTime);
    if (Number.isFinite(server)) {
      const local = performance.now();
      const estimated =
        serverClock.current.server + local - serverClock.current.local;
      serverClock.current = { server: Math.max(server, estimated), local };
      setMonotonicNow(local);
    }
  }, []);
  const [cards, setCards] = useState<LinkCard[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [url, setURL] = useState("");
  const [cursor, setCursor] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const scope = useRef(new AbortController());
  const authenticatedUser = useRef<string | null>(null);
  const busy = useRef(new Set<string>());
  const active = useRef(new Map<string, number>());
  const retryGeneration = useRef(new Map<string, number>());
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
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

  const invalidate = useCallback(() => {
    scope.current.abort();
    authenticatedUser.current = null;
    focusCard.current = null;
    busy.current.clear();
    active.current.clear();
    retryGeneration.current.clear();
    setRetrying({});
    setRetryErrors({});
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
  }, []);
  const unauthorized = useCallback(
    (error: unknown) => {
      if (error instanceof LibraryError && error.status === 401) {
        invalidate();
        return true;
      }
      return false;
    },
    [invalidate],
  );
  useEffect(() => {
    let loading = false;
    let revalidating = false;
    async function load() {
      if (loading) return;
      loading = true;
      scope.current.abort();
      authenticatedUser.current = null;
      focusCard.current = null;
      const controller = new AbortController();
      scope.current = controller;
      busy.current.clear();
      active.current.clear();
      retryGeneration.current.clear();
      setRetrying({});
      setRetryErrors({});
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
        authenticatedUser.current = identity.id;
        setUser(identity);
        syncClock(page.server_time);
        setCards(page.links);
        setCursor(page.next_cursor);
        page.links
          .filter((card) => card.state === "processing")
          .forEach((card) =>
            active.current.set(
              card.id,
              Math.max(active.current.get(card.id) ?? 0, card.generation),
            ),
          );
        setStatus("ready");
        void discover(controller);
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus(
          error instanceof LibraryError && error.status === 401
            ? "anonymous"
            : "error",
        );
      } finally {
        loading = false;
      }
    }
    async function revalidate() {
      if (loading || revalidating) return;
      if (!authenticatedUser.current) {
        await load();
        return;
      }
      revalidating = true;
      const controller = scope.current;
      try {
        const identity = await currentUser(controller.signal);
        if (controller.signal.aborted) return;
        if (identity.id !== authenticatedUser.current) {
          // A different account must never inherit the previous owner's UI.
          await load();
          return;
        }
        const page = await listLinks(controller.signal);
        if (controller.signal.aborted) return;
        setUser(identity);
        setError("");
        syncClock(page.server_time);
        setCards((current) => mergeCards(current, page.links));
        setCursor((current) => current || page.next_cursor);
        // Preserve loaded pagination, drafts, input and in-flight mutations.
        await discover(controller);
      } catch (error) {
        if (!controller.signal.aborted && !unauthorized(error))
          setError(
            "Не удалось обновить библиотеку. Попробуем при восстановлении связи.",
          );
      } finally {
        revalidating = false;
      }
    }
    let polling = false;
    async function discover(controller: AbortController) {
      try {
        let cursor = "";
        do {
          const page = await statuses(controller.signal, undefined, cursor);
          if (controller.signal.aborted) return;
          syncClock(page.server_time);
          page.links.forEach((card) =>
            active.current.set(
              card.id,
              Math.max(active.current.get(card.id) ?? 0, card.generation),
            ),
          );
          setCards((current) => mergeCards(current, page.links));
          cursor = page.next_cursor;
        } while (cursor && !controller.signal.aborted);
      } catch (error) {
        if (!controller.signal.aborted) unauthorized(error);
      }
    }
    async function refresh() {
      if (
        polling ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        active.current.size === 0
      )
        return;
      polling = true;
      const controller = scope.current;
      try {
        const ids = [...active.current.keys()];
        for (let i = 0; i < ids.length; i += 100) {
          const batch = ids.slice(i, i + 100);
          const page = await statuses(controller.signal, batch);
          if (controller.signal.aborted) return;
          syncClock(page.server_time);
          setError("");
          const returned = new Set(page.links.map((card) => card.id));
          page.links.forEach((card) => {
            if (card.state === "processing")
              active.current.set(
                card.id,
                Math.max(active.current.get(card.id) ?? 0, card.generation),
              );
            if (
              card.state !== "processing" &&
              card.generation >= (active.current.get(card.id) ?? 0)
            )
              active.current.delete(card.id);
          });
          const completed = page.links.filter(
            (card) => card.state !== "processing",
          );
          if (completed.length)
            setMessage(`Обработка завершена: ${completed.length}.`);
          setCards((current) => mergeCards(current, page.links));
          if (batch.some((id) => !returned.has(id))) {
            await load();
            return;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && !unauthorized(error))
          setError(
            "Не удалось обновить статусы. Проверим снова при восстановлении связи.",
          );
      } finally {
        polling = false;
      }
    }
    const clockTimer = window.setInterval(() => {
      if (active.current.size) setMonotonicNow(performance.now());
    }, 1000);
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    reload.current = () => {
      void load();
    };
    void load();
    const restore = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    window.addEventListener("online", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      scope.current.abort();
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
      window.removeEventListener("online", restore);
      document.removeEventListener("visibilitychange", restore);
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
    };
  }, [unauthorized, syncClock]);

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
      syncClock(result.server_time);
      focusCard.current = result.link.id;
      if (result.link.state === "processing")
        active.current.set(result.link.id, result.link.generation);
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
  async function retry(card: LinkCard) {
    if (busy.current.has(card.id)) return;
    busy.current.add(card.id);
    const generation = Math.max(
      retryGeneration.current.get(card.id) ?? card.generation,
      card.generation,
    );
    retryGeneration.current.set(card.id, generation);
    setRetrying((current) => ({ ...current, [card.id]: true }));
    setRetryErrors((current) => ({ ...current, [card.id]: "" }));
    const controller = scope.current;
    try {
      const result = await retryLink(controller.signal, card.id, generation);
      if (controller.signal.aborted) return;
      retryGeneration.current.delete(card.id);
      syncClock(result.server_time);
      if (result.link.state === "processing")
        active.current.set(
          card.id,
          Math.max(active.current.get(card.id) ?? 0, result.link.generation),
        );
      setCards((current) => mergeCards(current, [result.link]));
    } catch (error) {
      if (controller.signal.aborted || unauthorized(error)) return;
      setRetryErrors((current) => ({
        ...current,
        [card.id]:
          "Не удалось подтвердить повторную обработку. Нажмите «Повторить» ещё раз — дополнительная попытка не будет создана.",
      }));
    } finally {
      if (scope.current === controller) {
        busy.current.delete(card.id);
        setRetrying((current) => ({ ...current, [card.id]: false }));
      }
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
        syncClock(page.server_time);
        page.links
          .filter((card) => card.state === "processing")
          .forEach((card) =>
            active.current.set(
              card.id,
              Math.max(active.current.get(card.id) ?? 0, card.generation),
            ),
          );
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
        if (card.state === "processing") {
          active.current.set(
            id,
            Math.max(active.current.get(id) ?? 0, card.generation),
          );
        } else if (card.generation >= (active.current.get(id) ?? 0)) {
          active.current.delete(id);
        }
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
        <Button onClick={() => reload.current()}>Повторить</Button>
      </main>
    );

  if (status !== "ready" || !user)
    return (
      <Welcome>
        <p className="note">Войдите, чтобы открыть личную библиотеку.</p>
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
            <p className={styles.eyebrow} role="status">
              {
                {
                  processing:
                    serverClock.current.server +
                      monotonicNow -
                      serverClock.current.local -
                      Date.parse(card.requested_at) >=
                    30_000
                      ? "Обработка занимает больше времени"
                      : "Обрабатываем",
                  ready: "Готово",
                  unavailable: "Текст статьи недоступен",
                  failed: "Ошибка обработки",
                }[card.state]
              }
            </p>
            {card.title && <h2>{card.title}</h2>}
            <p className={styles.address}>{card.submitted_url}</p>
            {(card.state === "failed" || card.state === "unavailable") && (
              <p>
                {processingReason(
                  card.reason ??
                    (card.state === "unavailable"
                      ? "article_unavailable"
                      : null),
                )}
              </p>
            )}
            {retryErrors[card.id] &&
              retryGeneration.current.get(card.id) === card.generation && (
                <p role="alert">{retryErrors[card.id]}</p>
              )}
            <div className={styles.actions}>
              {(card.state === "failed" || card.state === "unavailable") && (
                <button
                  disabled={!!retrying[card.id]}
                  onClick={() => void retry(card)}
                >
                  {retrying[card.id] ? "Отправляем повтор…" : "Повторить"}
                </button>
              )}
              {card.state === "ready" && card.can_read !== false && (
                <Link href={`/links/${card.id}`}>Читать статью</Link>
              )}

              {card.state !== "ready" && (
                <button
                  disabled={opening !== null}
                  onClick={() => {
                    void openCard(card.id);
                  }}
                >
                  {opening === card.id ? "Открываем…" : "Открыть карточку"}
                </button>
              )}
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
