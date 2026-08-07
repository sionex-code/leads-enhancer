import AppShell from "../components/app/AppShell";
import InstallGuide from "./InstallGuide";

export const metadata = {
  title: "Install the LeadsFunda extension",
  description:
    "Install the LeadsFunda Chrome extension to run live lead searches in your own browser.",
};

export default function ExtensionPage() {
  return (
    <AppShell
      active="extension"
      title="Browser extension"
      subtitle="Run live searches in your own browser"
    >
      <div className="mx-auto max-w-3xl">
        <p className="max-w-2xl text-muted-foreground">
          Most searches are served instantly from leads we already have. When a
          search covers ground we haven&apos;t collected yet, the extension pulls
          it straight from the map on your machine — no queue, and no waiting
          behind anyone else&apos;s search.
        </p>

        <InstallGuide />
      </div>
    </AppShell>
  );
}
