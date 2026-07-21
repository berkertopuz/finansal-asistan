import { Skeleton } from "@/components/ui/skeleton";

// Suspense fallback for "/" only — nested segments (defter, portfoy, etc.)
// each ship their own more specific loading.tsx, which React prefers over
// this one once you're inside that segment.
export default function HomeLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 py-6">
      <div className="flex flex-col gap-2 px-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-6 w-40 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 px-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}
