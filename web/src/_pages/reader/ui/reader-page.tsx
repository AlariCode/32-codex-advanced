"use client";

import {
  usePrivateHistory,
  verifySession,
  isUnauthorized,
  loginPath,
  resetSession,
  subscribeSessionReset,
} from "@/shared/auth";
import {
  ActionLink,
  ExternalActionLink,
  Button,
  Notice,
  PageFrame,
  PageHeader,
} from "@/shared/ui";
import { useEffect, useState, useRef } from "react";
import {
  readArticle,
  ReaderError,
  type ArchivedArticle,
  type Block,
} from "../api/document";
import { RichBlock } from "./rich-block";
import { CodeBlock } from "./code-block";
import styles from "./reader.module.css";

function TextBlock({ block }: { block: Block }) {
  if (block.kind === "code")
    return <CodeBlock text={block.text!} language={block.language} />;
  if (block.kind === "paragraph") return <p>{block.text}</p>;
  if (block.kind === "quote")
    return (
      <blockquote>
        <p>{block.text}</p>
      </blockquote>
    );
  if (block.kind === "list") {
    const items = block.items!.map((text, index) => (
      <li key={index}>{text}</li>
    ));
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  switch (block.level) {
    case 2:
      return <h2>{block.text}</h2>;
    case 3:
      return <h3>{block.text}</h3>;
    case 4:
      return <h4>{block.text}</h4>;
    case 5:
      return <h5>{block.text}</h5>;
    default:
      return <h6>{block.text}</h6>;
  }
}
export function ReaderPage({ id }: { id: string }) {
  const [historyHidden, revealHistory] = usePrivateHistory();
  const [article, setArticle] = useState<ArchivedArticle | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let owner: string | null = null;
    let controller = new AbortController();
    let loaded = false;
    let loading = false;
    const unsubscribe = subscribeSessionReset(() => {
      controller.abort();
      owner = null;
      loaded = false;
      setArticle(null);
      setChecking(false);
    });
    async function load(background = false) {
      if (loading) return;
      loading = true;
      controller.abort();
      controller = new AbortController();
      const request = controller;
      if (!background || !loaded) {
        setChecking(true);
        setArticle(null);
      }
      setError("");
      try {
        const identity = await verifySession(request.signal);
        if (request.signal.aborted) return;
        if (owner && owner !== identity.id) {
          loaded = false;
          setArticle(null);
          setChecking(true);
        }
        owner = identity.id;
        revealHistory();
        const data = await readArticle(id, request.signal);
        if (!request.signal.aborted) {
          setArticle(data);
          loaded = true;
          setChecking(false);
        }
      } catch (error) {
        if (request.signal.aborted) return;
        setChecking(false);
        const code = isUnauthorized(error)
          ? "unauthorized"
          : error instanceof ReaderError
            ? error.code
            : "internal_error";
        if (isUnauthorized(error)) {
          resetSession();
          window.location.replace(loginPath());
        }
        if (code !== "internal_error") {
          loaded = false;
          setArticle(null);
        }
        setError(code);
      } finally {
        loading = false;
      }
    }
    const restore = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    reload.current = () => {
      void load(true);
    };
    void load();
    window.addEventListener("focus", restore);
    window.addEventListener("pageshow", restore);
    window.addEventListener("online", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      unsubscribe();
      controller.abort();
      window.removeEventListener("focus", restore);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("online", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [id, revealHistory]);
  const message =
    (
      {
        unauthorized: "Войдите, чтобы прочитать сохранённую статью.",
        not_found: "Статья не найдена.",
        article_not_ready: "Статья пока не готова к чтению.",
        article_unavailable: "Текст статьи недоступен.",
        unsupported_document: "Эта версия статьи не поддерживается.",
      } as Record<string, string>
    )[error] ?? "Не удалось загрузить статью.";
  const archiveWarnings = [
    [
      "images_omitted",
      "Часть изображений или оформления не сохранена. Пропущенные изображения отмечены в тексте.",
    ],
    [
      "html_truncated",
      "Сохранена часть статьи: HTML страницы превысил предел 3 MiB после распаковки. Текст после этого предела не сохранён.",
    ],
    [
      "text_incomplete",
      "Часть основного текста не удалось сохранить при извлечении статьи. Можно открыть оригинал и прочитать полную версию.",
    ],
    [
      "text_only_archive",
      "Часть оформления основного содержимого не поддерживается и не сохранена.",
    ],
  ].filter(([key]) => article?.warnings?.includes(key));

  if (historyHidden)
    return (
      <PageFrame className={styles.reader}>
        <PageHeader back />
        <div className={styles.feedback}>
          <Notice tone="neutral" role="status">
            Проверяем вход…
          </Notice>
          {error && (
            <>
              <Notice tone="danger" role="alert">
                Не удалось проверить вход.
              </Notice>
              <Button variant="secondary" onClick={() => reload.current()}>
                Повторить
              </Button>
            </>
          )}
        </div>
      </PageFrame>
    );

  return (
    <PageFrame className={styles.reader}>
      <PageHeader back />
      {checking && (
        <Notice tone="neutral" role="status">
          Открываем статью…
        </Notice>
      )}
      {error && (
        <div className={styles.feedback}>
          {!article && <h1>Статья недоступна</h1>}
          <Notice tone="danger" role="alert">
            {message}
          </Notice>
          {error === "internal_error" && (
            <Button variant="secondary" onClick={() => reload.current()}>
              Повторить
            </Button>
          )}
          {error === "unauthorized" && (
            <ActionLink href={loginPath()}>Войти</ActionLink>
          )}
        </div>
      )}
      {!checking && article && (
        <article className={styles.paper} aria-label="Сохранённая статья">
          <header className={styles.articleHeader}>
            <p className={styles.eyebrow}>Сохранённая версия</p>
            <h1>{article.title}</h1>
            <ExternalActionLink href={article.submitted_url}>
              Открыть оригинал
            </ExternalActionLink>
          </header>
          {archiveWarnings.length > 0 && (
            <Notice tone="warning" className={styles.warning} role="note">
              {archiveWarnings.map(([key, description]) => (
                <span key={key}>{description}</span>
              ))}
            </Notice>
          )}
          <div className={styles.body}>
            {article.document.blocks.map((block, index) =>
              article.document.schema_version === 2 ? (
                <RichBlock
                  key={index}
                  block={block}
                  linkID={id}
                  revalidate={() => reload.current()}
                />
              ) : (
                <TextBlock key={index} block={block} />
              ),
            )}
          </div>
        </article>
      )}
    </PageFrame>
  );
}
