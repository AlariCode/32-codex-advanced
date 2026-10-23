"use client";
import { useEffect, useState, useCallback } from "react";
import { flushSync } from "react-dom";

// Hide before the browser takes a history snapshot. Restore private UI only
// after /me has verified the account, while keeping the page's state in memory.
export function usePrivateHistory() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const hide = () => flushSync(() => setHidden(true));
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);
  const reveal = useCallback(() => setHidden(false), []);
  return [hidden, reveal] as const;
}
