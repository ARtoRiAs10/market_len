import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-6xl font-bold text-muted-foreground/30">404</p>
      <h1 className="font-display text-2xl">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link href="/dashboard"><Button>Go to dashboard</Button></Link>
    </div>
  );
}
