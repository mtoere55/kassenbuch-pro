import { AppShell } from "@/components/AppShell";
import { KassenProvider } from "@/lib/store";

export default function Home() {
  return (
    <KassenProvider>
      <AppShell />
    </KassenProvider>
  );
}
