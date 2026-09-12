import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentSession, requestMeta } from "@/lib/auth/current-user";
import { ensureMfaEnrollment } from "@/lib/auth/mfa";
import { EnrollForm } from "@/components/auth/enroll-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Set up your authenticator" };

/**
 * Enrollment page. After the code is confirmed the server action returns the recovery codes to the
 * client form, and this page re-renders in the "already enrolled" state WITHOUT redirecting, so the
 * codes stay on screen until the user clicks Continue.
 */
export default async function EnrollPage() {
  const resolved = await getCurrentSession();
  if (!resolved) redirect("/login");
  const enrolled = !!resolved.user.mfaEnrolledAt;
  if (enrolled && !resolved.session.mfaVerifiedAt) redirect("/mfa/verify");

  let qrDataUrl: string | null = null;
  let grouped: string | null = null;
  if (!enrolled) {
    const meta = await requestMeta();
    const enrollment = await ensureMfaEnrollment(db, {
      userId: resolved.user.id,
      sessionId: resolved.session.id,
      ...meta,
    });
    qrDataUrl = enrollment.qrDataUrl;
    grouped = enrollment.secret.match(/.{1,4}/g)?.join(" ") ?? enrollment.secret;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {enrolled ? "Your authenticator is set up" : "Set up your authenticator app"}
        </CardTitle>
        <CardDescription>
          {enrolled ? (
            <>
              Every sign-in for{" "}
              <span className="text-foreground font-medium">{resolved.user.email}</span> now needs
              the 6-digit code from your authenticator app.
            </>
          ) : (
            <>
              Every sign-in needs a 6-digit code from an authenticator app (Google Authenticator,
              Microsoft Authenticator, 1Password, Authy…). This is a one-time setup for{" "}
              <span className="text-foreground font-medium">{resolved.user.email}</span>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!enrolled && qrDataUrl ? (
          <>
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
          </>
        ) : null}
        <EnrollForm alreadyEnrolled={enrolled} />
      </CardContent>
    </Card>
  );
}
