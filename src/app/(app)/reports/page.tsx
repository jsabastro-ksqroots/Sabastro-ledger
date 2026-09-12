import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Reports" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Reports"
        helper="Profit & Loss, Balance Sheet, Class P&L per property, Trial Balance and the tax export. Arrives in Phase 6."
      />
      <EmptyState
        icon={BarChart3}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
