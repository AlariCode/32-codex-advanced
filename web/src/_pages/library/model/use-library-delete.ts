import { deleteLink } from "../api/library";
import type { LibraryState } from "./use-library-state";

export function useLibraryDelete(library: LibraryState) {
  async function remove(id: string) {
    const {
      deleteBusyRef,
      deletedRef,
      scopeRef,
      setDeleting,
      setDeleteErrors,
      setCards,
      activeRef,
      retryGenerationRef,
      setMessage,
      unauthorized,
    } = library;
    if (deleteBusyRef.current.has(id) || deletedRef.current.has(id)) return;
    deleteBusyRef.current.add(id);
    setDeleting((current) => ({ ...current, [id]: true }));
    setDeleteErrors((current) => ({ ...current, [id]: "" }));
    const controller = scopeRef.current;
    try {
      await deleteLink(controller.signal, id);
      if (controller.signal.aborted) return;
      deletedRef.current.add(id);
      activeRef.current.delete(id);
      retryGenerationRef.current.delete(id);
      setCards((current) => current.filter((card) => card.id !== id));
      setMessage("Ссылка и сохранённая статья удалены");
      // The deleted card held focus. Give keyboard users a stable next action.
      document.getElementById("library-url")?.focus();
    } catch (error) {
      if (controller.signal.aborted || unauthorized(error)) return;
      setDeleteErrors((current) => ({
        ...current,
        [id]: "Не удалось подтвердить удаление. Карточка сохранена на экране. Повторите удаление.",
      }));
    } finally {
      if (scopeRef.current === controller) {
        deleteBusyRef.current.delete(id);
        setDeleting((current) => ({ ...current, [id]: false }));
      }
    }
  }
  return remove;
}
