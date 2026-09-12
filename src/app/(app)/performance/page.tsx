import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata = { title: "Performance" };

export default function Page() {
  return (
    <div>
      <PageHeader
        title="Performance"
        helper="Dashboards per entity and property: income vs. expense, NOI, cash over time. Arrives in Phase 6."
      />
      <EmptyState
        icon={TrendingUp}
        title="Nothing here yet"
        description="This section is a placeholder in Phase 0."
      />
    </div>
  );
}
