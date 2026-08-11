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
          Most searches come straight from leads we already have. For anything we
          have not collected yet, the extension pulls it from the map on your own
          machine, with no queue. Four steps, about two minutes.
        </p>

        <InstallGuide />
      </div>
    </AppShell>
  );
}
