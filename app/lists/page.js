import { redirect } from "next/navigation";

// Lists live inside the leads table now (filter dropdown + "Manage lists"), so
// this route only exists to keep old links, bookmarks and the Favorites card
// working. See app/components/app/AppShell.js for why the two pages merged.
export const dynamic = "force-dynamic";

export default function Page() {
  redirect("/leads");
}
