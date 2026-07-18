"use client";

import { useSyncExternalStore } from "react";

// navigator.onLine is external mutable state — useSyncExternalStore, not
// useEffect+useState, is the correct tool (and the one that's actually
// SSR-safe: getServerSnapshot stands in for the server having no concept
// of "offline").
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return !navigator.onLine;
}

function getServerSnapshot() {
  return false;
}

export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!offline) return null;

  return (
    <div className="bg-signal-caution-bg px-4 py-2 text-center text-xs text-signal-caution-foreground">
      Çevrimdışısın — son bilinen veriler gösteriliyor, yeni kayıt eklenemez.
    </div>
  );
}
