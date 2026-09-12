import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Receipts" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Receipts"
        helper="Upload receipts here (drag-and-drop or phone camera); they become drafts in the review queue. Arrives in Phase 3."
      />
      <EmptyState
        icon={Receipt}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
