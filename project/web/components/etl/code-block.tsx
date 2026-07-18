"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative">
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 rounded-md border bg-background/80 p-1.5 text-muted-foreground backdrop-blur hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="max-h-96 overflow-auto rounded-md border bg-[hsl(220,24%,5%)] p-4 font-mono text-xs leading-relaxed text-[hsl(40,20%,90%)]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
