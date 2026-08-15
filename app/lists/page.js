import ListsClient from "./ListsClient";

// The single "Lists" destination in the sidebar: the cards overview. Clicking a
// card opens /leads filtered to that list, where all the work happens (filter,
// sort, status, notes, delete). /leads has no nav entry of its own - the two
// used to be separate top-level items for what is one job.
export const dynamic = "force-dynamic";

export default function Page() {
  return <ListsClient />;
}
