import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requestMeta, requireHalfSession } from "@/lib/auth/current-user";
import { ensureMfaEnrollment } from "@/lib/auth/mfa";
import { EnrollForm } from "@/components/auth/enroll-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Set up your authenticator" };

export default async function EnrollPage() {
  const user = await requireHalfSession();
  if (user.mfaEnrolledAt) redirect("/mfa/verify");
  const meta = await requestMeta();
  const { secret, qrDataUrl } = await ensureMfaEnrollment(db, {
    userId: user.id,
    sessionId: user.sessionId,
    ...meta,
  });
  const grouped = secret.match(/.{1,4}/g)?.join(" ") ?? secret;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your authenticator app</CardTitle>
        <CardDescription>
          Every sign-in needs a 6-digit code from an authenticator app (Google Authenticator,
          Microsoft Authenticator, 1Password, Authy…). This is a one-time setup for{" "}
          <span className="text-foreground font-medium">{user.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
          <li>Open the authenticator app on your phone and choose “Add” or “+”.</li>
          <li>Scan this QR code (or type the key below it).</li>
          <li>Enter the 6-digit code the app shows to finish.</li>
        </ol>
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="QR code for your authenticator app"
            width={224}
            height={224}
            className="rounded border bg-white p-1"
          />
          <div className="text-muted-foreground text-center text-xs">
            Can’t scan? Enter this key manually:
            <div className="text-foreground mt-1 font-mono text-sm tracking-wider select-all">
              {grouped}
            </div>
          </div>
        </div>
        <EnrollForm />
      </CardContent>
    </Card>
  );
}
