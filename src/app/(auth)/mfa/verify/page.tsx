import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-user";
import { safeNext } from "@/server/actions/auth";
import { MfaVerifyForm } from "@/components/auth/mfa-verify-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Enter your code" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const resolved = await getCurrentSession();
  if (!resolved) redirect("/login");
  if (!resolved.user.mfaEnrolledAt) redirect("/mfa/enroll");
  const next = await safeNext(params.next);
  if (resolved.session.mfaVerifiedAt) redirect(next);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter your authenticator code</CardTitle>
        <CardDescription>
          Signed in as <span className="text-foreground font-medium">{resolved.user.email}</span>.
          Open your authenticator app and type the current 6-digit code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MfaVerifyForm next={next} />
      </CardContent>
    </Card>
  );
}
