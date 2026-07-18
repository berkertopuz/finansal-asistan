"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SWIPE_THRESHOLD = 72;
const MAX_DRAG = 120;

// Swipe-left-to-delete for touch (docs/phase1-plan.md B), plus an always-
// visible trash button so desktop/mouse users — who have no swipe gesture —
// aren't left without a way to delete (CLAUDE.md rule 4: works on both).
export function SwipeToDeleteRow({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    startX.current = e.clientX;
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const delta = e.clientX - startX.current;
    setDragX(Math.min(0, Math.max(delta, -MAX_DRAG)));
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragX < -SWIPE_THRESHOLD) onDelete();
    setDragX(0);
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={onDelete}
        aria-hidden
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-destructive/15 text-destructive"
      >
        <Trash2 className="size-5" />
      </button>
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ transform: `translateX(${dragX}px)` }}
        className={cn(
          "relative flex items-center gap-1 bg-card",
          !dragging && "transition-transform duration-200",
        )}
      >
        <div className="min-w-0 flex-1">{children}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-touch"
          aria-label="Kaydı sil"
          onClick={onDelete}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}
