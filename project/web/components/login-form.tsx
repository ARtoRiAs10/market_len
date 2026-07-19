"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPassword, setPendingPassword] = useState("");

  async function attemptSignIn(email: string, password: string, totpCode?: string) {
    setError(null);
    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      totpCode,
      redirect: false,
    });

    setLoading(false);

    if (res?.error === "2FA_REQUIRED") {
      setNeedsTotp(true);
      setPendingEmail(email);
      setPendingPassword(password);
      return;
    }

    if (res?.error) {
      setError(needsTotp ? "Invalid 2FA code." : "Invalid email or password.");
      return;
    }

    toast({ title: "Welcome back", description: "Redirecting to your dashboard..." });
    router.push(searchParams.get("callbackUrl") || "/dashboard");
    router.refresh();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (needsTotp) {
      await attemptSignIn(pendingEmail, pendingPassword, String(formData.get("totpCode") ?? ""));
      return;
    }

    await attemptSignIn(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {!needsTotp ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="totpCode">6-digit code</Label>
            <Input id="totpCode" name="totpCode" inputMode="numeric" maxLength={6} placeholder="123456" required autoComplete="one-time-code" autoFocus />
            <p className="text-xs text-muted-foreground">Enter the code from your authenticator app, or a backup code.</p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {needsTotp ? "Verify" : "Log in"}
        </Button>
      </form>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      >
        Google
      </Button>
    </div>
  );
}
