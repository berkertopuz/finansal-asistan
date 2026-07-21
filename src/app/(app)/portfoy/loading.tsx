import { Skeleton } from "@/components/ui/skeleton";

export default function PortfoyLoading() {
  return (
    <div className="flex flex-1 flex-col py-6">
      <div className="flex flex-col gap-3 px-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
