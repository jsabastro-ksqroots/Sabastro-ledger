import { redirect } from "next/navigation";
import { requireFullSession, userCan } from "@/lib/auth/current-user";
import { SettingsTabs } from "@/components/shell/settings-tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireFullSession();
  if (!userCan(user, "VIEW_SETTINGS")) redirect("/dashboard?denied=settings");
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Who can sign in, what they did, and the building blocks of the books.
        </p>
      </div>
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </div>
  );
}
