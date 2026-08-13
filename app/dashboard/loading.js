// Shown while /dashboard renders on the server. It is force-dynamic, so on a
// slow connection the whole screen used to sit on the previous page with no
// sign that anything was happening. The sidebar spinner says the click landed;
// this says the page is on its way.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  );
}
