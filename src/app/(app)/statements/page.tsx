import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Statements" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Statements"
        helper="Bank of America statements and Venmo exports are imported and reconciled here month by month. Arrives in Phase 4."
      />
      <EmptyState
        icon={Landmark}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
