import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-user";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signed_out?: string }>;
}) {
  const params = await searchParams;
  const existing = await getCurrentSession();
  if (existing)
    redirect(
      existing.session.mfaVerifiedAt
        ? "/dashboard"
        : existing.user.mfaEnrolledAt
          ? "/mfa/verify"
          : "/mfa/enroll",
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {params.signed_out === "everywhere"
            ? "You have been signed out on every device."
            : "Use your email and password, then the code from your authenticator app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={params.next} />
      </CardContent>
    </Card>
  );
}
