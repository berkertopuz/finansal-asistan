"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

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

// Always mounted — a grid-rows transition collapses/expands it instead of
// mounting/unmounting the element, so a mid-session connectivity change
// animates smoothly instead of jumping the layout (CLS).
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const t = useTranslations("common");

  return (
    <div
      className="grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: offline ? "1fr" : "0fr" }}
    >
      <div className="min-h-0">
        <div className="bg-signal-caution-bg px-4 py-2 text-center text-xs text-signal-caution-foreground">
          {t("offlineBanner")}
        </div>
      </div>
    </div>
  );
}
