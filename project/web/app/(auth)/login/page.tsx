import { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Log in — MarketLens" };

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-2xl">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">Log in to continue your analysis.</p>
      <div className="mt-8">
        <LoginForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-foreground underline underline-offset-4">
          Create one
        </Link>
      </p>
    </div>
  );
}
