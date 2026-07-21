import { Skeleton } from "@/components/ui/skeleton";

export default function DefterLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="px-4 md:px-0">
        <Skeleton className="h-44 w-full rounded-2xl md:h-32" />
      </div>
      <div className="px-4 md:px-0">
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-2 px-4 md:px-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
