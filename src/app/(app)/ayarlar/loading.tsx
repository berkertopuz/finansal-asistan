import { Skeleton } from "@/components/ui/skeleton";

export default function AyarlarLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-6">
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-touch w-full rounded-lg" />
    </div>
  );
}
