import { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/register-form";

export const metadata: Metadata = { title: "Create account — MarketLens" };

export default function RegisterPage() {
  return (
    <div className="w-full max-w-sm">
      <h1 className="font-display text-2xl">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Free plan includes 5 companies and the Piotroski F-Score strategy.
      </p>
      <div className="mt-8">
        <RegisterForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Log in
        </Link>
      </p>
    </div>
  );
}
