import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Review" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Review"
        helper="Drafts and flagged items will queue here for confirmation. Arrives in Phase 3 (receipts and the AI classifier)."
      />
      <EmptyState
        icon={Inbox}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
