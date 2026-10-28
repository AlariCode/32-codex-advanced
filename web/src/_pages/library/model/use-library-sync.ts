import { useEffect } from "react";
import { isUnauthorized, subscribeSessionReset } from "@/shared/auth";
import { currentUser, listLinks, statuses } from "../api/library";
import { readDrafts } from "./draft-storage";
import { mergeCards } from "./library";
import type { LibraryState } from "./use-library-state";

export function useLibrarySync(library: LibraryState) {
  const {
    revealHistory,
    setUser,
    setStatus,
    setMonotonicNow,
    syncClock,
    setCards,
    setDrafts,
    setURL,
    setStorageError,
    setCursor,
    setMessage,
    setError,
    setLoadingMore,
    setOpening,
    scopeRef,
    authenticatedUserRef,
    busyRef,
    activeRef,
    retryGenerationRef,
    setRetrying,
    setRetryErrors,
    moreBusyRef,
    openBusyRef,
    focusCardRef,
    reloadRef,
    repeatRef,
    invalidate,
    unauthorized,
  } = library;
  useEffect(() => {
    const unsubscribe = subscribeSessionReset(invalidate);
    let loading = false;
    let revalidating = false;
    async function load() {
      if (loading) return;
      loading = true;
      scopeRef.current.abort();
      authenticatedUserRef.current = null;
      focusCardRef.current = null;
      const controller = new AbortController();
      scopeRef.current = controller;
      busyRef.current.clear();
      activeRef.current.clear();
      retryGenerationRef.current.clear();
      setRetrying({});
      setRetryErrors({});
      moreBusyRef.current = false;
      openBusyRef.current = false;
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
        authenticatedUserRef.current = identity.id;
        setUser(identity);
        try {
          const saved = readDrafts(identity.id);
          setURL(saved.url);
          setDrafts(saved.drafts);
          setStorageError(false);
        } catch {
          setStorageError(true);
        }
        syncClock(page.server_time);
        setCards(page.links);
        setCursor(page.next_cursor);
        page.links
          .filter((card) => card.state === "processing")
          .forEach((card) =>
            activeRef.current.set(
              card.id,
              Math.max(activeRef.current.get(card.id) ?? 0, card.generation),
            ),
          );
        revealHistory();
        setStatus("ready");
        void discover(controller);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isUnauthorized(error)) revealHistory();
        else setError("Не удалось загрузить библиотеку. Попробуйте ещё раз.");
        setStatus(isUnauthorized(error) ? "anonymous" : "error");
      } finally {
        loading = false;
      }
    }
    async function revalidate() {
      if (loading || revalidating) return;
      if (!authenticatedUserRef.current) {
        await load();
        return;
      }
      revalidating = true;
      const controller = scopeRef.current;
      try {
        const identity = await currentUser(controller.signal);
        if (controller.signal.aborted) return;
        if (identity.id !== authenticatedUserRef.current) {
          // A different account must never inherit the previous owner's UI.
          await load();
          return;
        }
        revealHistory();
        const page = await listLinks(controller.signal);
        if (controller.signal.aborted) return;
        setUser(identity);
        setError("");
        syncClock(page.server_time);
        setCards((current) => mergeCards(current, page.links));

        // Preserve loaded pagination, drafts, input and in-flight mutations.
        await discover(controller);
      } catch (error) {
        if (!controller.signal.aborted && !unauthorized(error)) {
          repeatRef.current = () => reloadRef.current();
          setError(
            "Не удалось обновить библиотеку. Повторите загрузку или дождитесь восстановления связи.",
          );
        }
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
            activeRef.current.set(
              card.id,
              Math.max(activeRef.current.get(card.id) ?? 0, card.generation),
            ),
          );
          setCards((current) => mergeCards(current, page.links));
          cursor = page.next_cursor;
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted) setError("");
      } catch (error) {
        if (!controller.signal.aborted && !unauthorized(error)) {
          repeatRef.current = () => reloadRef.current();
          setError(
            "Не удалось проверить обрабатываемые ссылки. Повторите загрузку.",
          );
        }
      }
    }
    async function refresh() {
      if (
        polling ||
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        activeRef.current.size === 0
      )
        return;
      polling = true;
      const controller = scopeRef.current;
      try {
        const ids = [...activeRef.current.keys()];
        for (let i = 0; i < ids.length; i += 100) {
          const batch = ids.slice(i, i + 100);
          const page = await statuses(controller.signal, batch);
          if (controller.signal.aborted) return;
          syncClock(page.server_time);
          setError("");
          const returned = new Set(page.links.map((card) => card.id));
          page.links.forEach((card) => {
            if (card.state === "processing")
              activeRef.current.set(
                card.id,
                Math.max(activeRef.current.get(card.id) ?? 0, card.generation),
              );
            if (
              card.state !== "processing" &&
              card.generation >= (activeRef.current.get(card.id) ?? 0)
            )
              activeRef.current.delete(card.id);
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
        if (!controller.signal.aborted && !unauthorized(error)) {
          repeatRef.current = () => {
            void refresh();
          };
          setError(
            "Не удалось обновить статусы. Повторите загрузку или дождитесь восстановления связи.",
          );
        }
      } finally {
        polling = false;
      }
    }
    const clockTimer = window.setInterval(() => {
      if (activeRef.current.size) setMonotonicNow(performance.now());
    }, 1000);
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    reloadRef.current = () => {
      if (authenticatedUserRef.current) void revalidate();
      else void load();
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
      unsubscribe();
      scopeRef.current.abort();
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
      window.removeEventListener("online", restore);
      document.removeEventListener("visibilitychange", restore);
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
    };
  }, [
    unauthorized,
    syncClock,
    invalidate,
    revealHistory,
    activeRef,
    authenticatedUserRef,
    busyRef,
    focusCardRef,
    moreBusyRef,
    openBusyRef,
    reloadRef,
    repeatRef,
    retryGenerationRef,
    scopeRef,
    setCards,
    setCursor,
    setDrafts,
    setError,
    setLoadingMore,
    setMessage,
    setMonotonicNow,
    setOpening,
    setRetryErrors,
    setRetrying,
    setStatus,
    setStorageError,
    setURL,
    setUser,
  ]);
}
