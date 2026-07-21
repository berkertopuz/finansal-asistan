import { Skeleton } from "@/components/ui/skeleton";

export default function OnerilerLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 py-6">
      <div className="flex flex-col gap-3 px-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
