import type { FormEvent } from "react";
import {
  getLink,
  LibraryError,
  listLinks,
  saveLink,
  retryLink,
} from "../api/library";
import { mergeCards, validURL, type Draft, type LinkCard } from "./library";
import type { LibraryState } from "./use-library-state";

export function useLibraryActions(library: LibraryState) {
  const {
    syncClock,
    setCards,
    setDrafts,
    url,
    setURL,
    cursor,
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
    repeatRef,
    unauthorized,
  } = library;
  async function send(id: string, raw: string) {
    if (busyRef.current.has(id)) return;
    const normalized = raw.trim();
    const draft: Draft = {
      id,
      url: normalized,
      state: validURL(normalized) ? "sending" : "invalid",
      user_id: authenticatedUserRef.current!,
      updated_at: new Date().toISOString(),
    };
    setDrafts((current) => [
      draft,
      ...current.filter((item) => item.id !== id),
    ]);
    setMessage("");
    if (draft.state === "invalid") return;
    busyRef.current.add(id);
    const controller = scopeRef.current;
    try {
      const result = await saveLink(controller.signal, normalized);
      if (controller.signal.aborted) return;
      syncClock(result.server_time);
      focusCardRef.current = result.link.id;
      if (result.link.state === "processing")
        activeRef.current.set(result.link.id, result.link.generation);
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
                updated_at: new Date().toISOString(),
                state:
                  error instanceof LibraryError && error.code === "invalid_url"
                    ? "invalid"
                    : error instanceof LibraryError
                      ? "error"
                      : "unknown",
              }
            : item,
        ),
      );
    } finally {
      if (scopeRef.current === controller) busyRef.current.delete(id);
    }
  }
  async function retry(card: LinkCard) {
    if (busyRef.current.has(card.id)) return;
    busyRef.current.add(card.id);
    const generation = Math.max(
      retryGenerationRef.current.get(card.id) ?? card.generation,
      card.generation,
    );
    retryGenerationRef.current.set(card.id, generation);
    setRetrying((current) => ({ ...current, [card.id]: true }));
    setRetryErrors((current) => ({ ...current, [card.id]: "" }));
    const controller = scopeRef.current;
    try {
      const result = await retryLink(controller.signal, card.id, generation);
      if (controller.signal.aborted) return;
      retryGenerationRef.current.delete(card.id);
      syncClock(result.server_time);
      if (result.link.state === "processing")
        activeRef.current.set(
          card.id,
          Math.max(activeRef.current.get(card.id) ?? 0, result.link.generation),
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
      if (scopeRef.current === controller) {
        busyRef.current.delete(card.id);
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
    if (moreBusyRef.current) return;
    moreBusyRef.current = true;
    setLoadingMore(true);
    setError("");
    const controller = scopeRef.current;
    try {
      const page = await listLinks(controller.signal, cursor);
      if (!controller.signal.aborted) {
        syncClock(page.server_time);
        page.links
          .filter((card) => card.state === "processing")
          .forEach((card) =>
            activeRef.current.set(
              card.id,
              Math.max(activeRef.current.get(card.id) ?? 0, card.generation),
            ),
          );
        setCards((current) => mergeCards(current, page.links));
        setCursor(page.next_cursor);
      }
    } catch (error) {
      if (!controller.signal.aborted && !unauthorized(error)) {
        repeatRef.current = () => {
          void more();
        };
        setError("Не удалось загрузить ссылки. Попробуйте ещё раз.");
      }
    } finally {
      if (scopeRef.current === controller) {
        moreBusyRef.current = false;
        setLoadingMore(false);
      }
    }
  }
  async function openCard(id: string) {
    if (openBusyRef.current) return;
    openBusyRef.current = true;
    setOpening(id);
    setError("");
    const controller = scopeRef.current;
    try {
      const card = await getLink(controller.signal, id);
      if (!controller.signal.aborted) {
        focusCardRef.current = id;
        if (card.state === "processing") {
          activeRef.current.set(
            id,
            Math.max(activeRef.current.get(id) ?? 0, card.generation),
          );
        } else if (card.generation >= (activeRef.current.get(id) ?? 0)) {
          activeRef.current.delete(id);
        }
        setCards((current) => mergeCards(current, [card]));
      }
    } catch (error) {
      if (!controller.signal.aborted && !unauthorized(error)) {
        repeatRef.current = () => {
          void openCard(id);
        };
        setError("Не удалось открыть карточку. Попробуйте ещё раз.");
      }
    } finally {
      if (scopeRef.current === controller) {
        openBusyRef.current = false;
        setOpening(null);
      }
    }
  }

  function editDraft(id: string, value: string) {
    setDrafts((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, url: value, updated_at: new Date().toISOString() }
          : item,
      ),
    );
  }

  return { send, retry, submit, more, openCard, editDraft };
}
