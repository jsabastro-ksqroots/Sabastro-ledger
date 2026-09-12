import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-card flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      {Icon ? <Icon className="text-muted-foreground mb-3 h-8 w-8" aria-hidden /> : null}
      <div className="text-base font-medium">{title}</div>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-md text-sm">{description}</p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
