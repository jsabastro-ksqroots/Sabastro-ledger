import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Ledger" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Ledger"
        helper="Every posted transaction, with journal view, receipts and provenance. Arrives in Phase 1."
      />
      <EmptyState
        icon={BookOpen}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
