import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePrivateHistory,
  isUnauthorized,
  loginPath,
  resetSession,
} from "@/shared/auth";
import type { UserDTO } from "@/shared/api";
import { writeDrafts } from "./draft-storage";
import type { Draft, LinkCard } from "./library";

export function useLibraryState() {
  const [historyHidden, revealHistory] = usePrivateHistory();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [status, setStatus] = useState<
    "checking" | "anonymous" | "ready" | "error"
  >("checking");
  const serverClockRef = useRef({ server: 0, local: 0 });
  const [monotonicNow, setMonotonicNow] = useState(0);
  const syncClock = useCallback((serverTime: string) => {
    const server = Date.parse(serverTime);
    if (Number.isFinite(server)) {
      const local = performance.now();
      const estimated =
        serverClockRef.current.server + local - serverClockRef.current.local;
      serverClockRef.current = { server: Math.max(server, estimated), local };
      setMonotonicNow(local);
    }
  }, []);
  const [cards, setCards] = useState<LinkCard[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [url, setURL] = useState("");
  const [storageError, setStorageError] = useState(false);
  const authenticatedUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || authenticatedUserRef.current !== user.id) return;
    try {
      writeDrafts(user.id, url, drafts);
    } catch {
      // Report a failed localStorage write without changing the existing timing.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageError(true);
    }
  }, [user, url, drafts]);
  const [cursor, setCursor] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const scopeRef = useRef(new AbortController());
  const busyRef = useRef(new Set<string>());
  const activeRef = useRef(new Map<string, number>());
  const retryGenerationRef = useRef(new Map<string, number>());
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const moreBusyRef = useRef(false);
  const openBusyRef = useRef(false);
  const focusCardRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusCardRef.current) return;
    const element = document.getElementById(`link-${focusCardRef.current}`);
    if (element) {
      element.focus();
      element.scrollIntoView({ block: "nearest", behavior: "instant" });
      focusCardRef.current = null;
    }
  }, [cards]);
  const reloadRef = useRef<() => void>(() => {});
  const repeatRef = useRef<() => void>(() => reloadRef.current());

  const invalidate = useCallback(() => {
    scopeRef.current.abort();
    authenticatedUserRef.current = null;
    focusCardRef.current = null;
    busyRef.current.clear();
    activeRef.current.clear();
    retryGenerationRef.current.clear();
    setRetrying({});
    setRetryErrors({});
    moreBusyRef.current = false;
    openBusyRef.current = false;
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
      if (isUnauthorized(error)) {
        resetSession();
        invalidate();
        window.location.replace(loginPath());
        return true;
      }
      return false;
    },
    [invalidate],
  );

  return {
    historyHidden,
    revealHistory,
    user,
    setUser,
    status,
    setStatus,
    serverClockRef,
    monotonicNow,
    setMonotonicNow,
    syncClock,
    cards,
    setCards,
    drafts,
    setDrafts,
    url,
    setURL,
    storageError,
    setStorageError,
    cursor,
    setCursor,
    message,
    setMessage,
    error,
    setError,
    loadingMore,
    setLoadingMore,
    opening,
    setOpening,
    scopeRef,
    authenticatedUserRef,
    busyRef,
    activeRef,
    retryGenerationRef,
    retrying,
    setRetrying,
    retryErrors,
    setRetryErrors,
    moreBusyRef,
    openBusyRef,
    focusCardRef,
    reloadRef,
    repeatRef,
    invalidate,
    unauthorized,
  };
}

export type LibraryState = ReturnType<typeof useLibraryState>;
