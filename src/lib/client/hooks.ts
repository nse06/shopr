"use client";

import { useSyncExternalStore } from "react";

const PHONE = "(max-width: 640px)";

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** New photos land in two columns on a phone and four on a bigger screen. */
export function useBoardColumns(): number {
  return useIsPhone() ? 2 : 4;
}
