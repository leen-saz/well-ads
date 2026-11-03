// The loading layout of the two performance pages. The pages render it on the server (Astro fallback slot), so it
// shows with the HTML instead of after the island's JavaScript; the islands show the same thing while the numbers load.
import { Skeleton } from '@/components/ui/skeleton';

export function OverviewSkeleton() {
  return (
    <div className="ui grid gap-4" aria-busy="true">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function CreativeSkeleton() {
  return (
    <div className="ui grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-96 rounded-xl" />)}
    </div>
  );
}
