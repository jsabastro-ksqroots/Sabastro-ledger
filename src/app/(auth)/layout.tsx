export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold tracking-tight">Sabastro Ledger</div>
          <div className="text-muted-foreground text-sm">Private books for SREI and PLA</div>
        </div>
        {children}
      </div>
    </div>
  );
}
