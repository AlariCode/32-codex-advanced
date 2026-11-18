"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UserDTO } from "@/shared/api";
import { subscribeSessionReset } from "@/shared/auth";
import { flushSync } from "react-dom";
import {
  ActionLink,
  Button,
  ConfirmationPanel,
  Notice,
  TextField,
} from "@/shared/ui";
import {
  profileRequest,
  tokenPath,
  type MCPToken,
  type CreatedMCPToken,
} from "../api/mcp-tokens";
import styles from "./profile.module.css";

export function ProfilePage() {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [tokens, setTokens] = useState<MCPToken[]>([]);
  const [secret, setSecret] = useState<CreatedMCPToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const epoch = useRef(0);
  const owner = useRef("");
  const secretInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  const fail = useCallback((err: unknown) => {
    if (err instanceof Error && err.message === "unauthorized") {
      epoch.current++;
      setSecret(null);
      setUser(null);
      setTokens([]);
      window.location.replace("/login?returnTo=%2Fprofile");
    } else
      setError(
        "Не удалось выполнить запрос. Проверьте соединение и повторите.",
      );
  }, []);

  const load = useCallback(async () => {
    const version = ++epoch.current;
    setLoading(true);
    setBusy(false);
    setConfirm(null);
    setError("");
    try {
      const current = await profileRequest<UserDTO>("/api/users/me");
      if (version !== epoch.current) return;
      if (owner.current !== current.id) {
        setUser(null);
        setSecret(null);
        setTokens([]);
      }
      owner.current = current.id;
      const list = await profileRequest<MCPToken[]>(tokenPath);
      if (version !== epoch.current) return;
      setUser(current);
      setTokens(list);
      setSecret((previous) =>
        previous && list.some((token) => token.id === previous.id)
          ? previous
          : null,
      );
    } catch (err) {
      if (version === epoch.current) fail(err);
    } finally {
      if (version === epoch.current) setLoading(false);
    }
  }, [fail]);

  useEffect(() => {
    const hide = () => {
      epoch.current++;
      flushSync(() => {
        setSecret(null);
        setUser(null);
        setTokens([]);
        setMessage("");
        setLoading(true);
      });
    };
    const unsubscribe = subscribeSessionReset(() => {
      hide();
      void load();
    });
    const generation = epoch;
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", load);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);

    return () => {
      mounted = false;
      generation.current++;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", load);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      unsubscribe();
    };
  }, [load]);

  async function create() {
    const version = epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await profileRequest<CreatedMCPToken>(tokenPath, "POST");
      if (version !== epoch.current) return;
      setSecret(result);
      setTokens((list) => [
        { id: result.id, created_at: result.created_at },
        ...list,
      ]);
      setMessage("Токен создан. Сохраните его сейчас.");
      requestAnimationFrame(() => secretInput.current?.focus());
    } catch (err) {
      if (version === epoch.current) fail(err);
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }
  async function revoke(id: string) {
    const version = epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await profileRequest<void>(`${tokenPath}/${id}`, "DELETE");
      if (version !== epoch.current) return;
      setTokens((list) => list.filter((item) => item.id !== id));
      if (secret?.id === id) setSecret(null);
      setConfirm(null);
      setMessage("Токен отозван. Доступ по нему закрыт.");
      requestAnimationFrame(() => createButton.current?.focus());
    } catch (err) {
      if (version === epoch.current) fail(err);
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }
  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.token);
      setMessage("Токен скопирован.");
    } catch {
      setMessage(
        "Не удалось скопировать. Выделите токен и скопируйте вручную.",
      );
      secretInput.current?.select();
    }
  }

  return (
    <main className={styles.profile}>
      <ActionLink href="/">← В библиотеку</ActionLink>
      <h1>Профиль</h1>
      {loading ? (
        <p role="status">Проверяем вход…</p>
      ) : (
        <>
          {user && (
            <>
              <p className={styles.email}>{user.email}</p>
              <section aria-labelledby="mcp-heading">
                <h2 id="mcp-heading">MCP-токены</h2>
                <p>
                  Подключите агента к своей библиотеке. Токен даёт доступ к
                  чтению, сохранению и удалению ссылок до отзыва.
                </p>
                <p>
                  Адрес сервера: <code>/mcp</code> на адресе API. Передавайте
                  токен в заголовке{" "}
                  <code>Authorization: Bearer &lt;токен&gt;</code>.
                </p>
                <Button
                  ref={createButton}
                  disabled={busy || !!secret}
                  onClick={create}
                >
                  {busy && !confirm ? "Создаём…" : "Создать MCP-токен"}
                </Button>
                {secret && (
                  <div className={styles.secret}>
                    <h3>Сохраните токен — он показывается один раз</h3>
                    <p>
                      После закрытия или обновления страницы посмотреть его
                      снова нельзя. Не передавайте токен другим людям.
                    </p>
                    <TextField
                      ref={secretInput}
                      id="mcp-secret"
                      label="Новый MCP-токен"
                      value={secret.token}
                      readOnly
                      autoComplete="off"
                      spellCheck={false}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <div className={styles.actions}>
                      <Button onClick={copy}>Скопировать</Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSecret(null);
                          setMessage("Токен скрыт.");
                          requestAnimationFrame(() =>
                            createButton.current?.focus(),
                          );
                        }}
                      >
                        Я сохранил токен
                      </Button>
                    </div>
                  </div>
                )}
                <h3>Активные токены</h3>
                {!tokens.length && <p>Активных токенов пока нет.</p>}
                <ul className={styles.tokens}>
                  {tokens.map((token) => (
                    <li key={token.id}>
                      <p>
                        <strong>Токен {token.id.slice(0, 8)}</strong>
                        <br />
                        Создан:{" "}
                        <time dateTime={token.created_at}>
                          {new Date(token.created_at).toLocaleString("ru-RU")}
                        </time>
                      </p>
                      {confirm === token.id ? (
                        <ConfirmationPanel
                          role="group"
                          aria-label="Подтверждение отзыва"
                        >
                          <p>
                            Отозвать токен? Подключённый агент потеряет доступ.
                            Для повторного подключения понадобится новый токен.
                          </p>
                          <div className={styles.actions}>
                            <Button
                              variant="danger"
                              autoFocus
                              disabled={busy}
                              onClick={() => revoke(token.id)}
                            >
                              {busy ? "Отзываем…" : "Подтвердить отзыв"}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setConfirm(null);
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById(`revoke-${token.id}`)
                                    ?.focus(),
                                );
                              }}
                            >
                              Отмена
                            </Button>
                          </div>
                        </ConfirmationPanel>
                      ) : (
                        <Button
                          variant="dangerText"
                          id={`revoke-${token.id}`}
                          disabled={busy}
                          aria-label={`Отозвать токен ${token.id.slice(0, 8)}`}
                          onClick={() => {
                            setConfirm(token.id);
                            setError("");
                          }}
                        >
                          Отозвать
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}
      <p role="status">{message}</p>
      {error && (
        <div role="alert">
          <Notice tone="danger">{error}</Notice>
          {!user && <Button onClick={load}>Повторить</Button>}
        </div>
      )}
    </main>
  );
}
