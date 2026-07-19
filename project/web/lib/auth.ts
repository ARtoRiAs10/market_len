import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { verifyTotpForUser, userHasTotpEnabled } from "@/lib/totp";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", newUser: "/dashboard" },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : []),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "2FA code", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) throw new Error("Email and password required");
        const email = credentials.email.toLowerCase().trim();

        // Rate-limit login attempts per-account AND per-IP so a credential-
        // stuffing / brute-force script can't hammer the password check.
        // (bcrypt.compare is slow, but that alone isn't a substitute for a
        // hard cap on attempts — OWASP A07: Identification & Authentication
        // Failures.)
        const forwardedFor = req?.headers?.["x-forwarded-for"];
        const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(",")[0]?.trim() ?? "unknown";
        const byAccount = rateLimit(`login:acct:${email}`, { limit: 8, windowMs: 5 * 60_000 });
        const byIp = rateLimit(`login:ip:${ip}`, { limit: 20, windowMs: 5 * 60_000 });
        if (!byAccount.success || !byIp.success) {
          throw new Error("Too many login attempts. Please wait a few minutes and try again.");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) throw new Error("Invalid email or password");
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) throw new Error("Invalid email or password");

        // Enforce TOTP 2FA if the user has it enabled. Previously the app
        // let users set up and "activate" 2FA, but nothing at sign-in ever
        // checked it — 2FA was decorative and could be silently bypassed
        // with just the password.
        if (await userHasTotpEnabled(prisma, user.id)) {
          if (!credentials.totpCode) throw new Error("2FA_REQUIRED");
          const totpOk = await verifyTotpForUser(prisma, user.id, credentials.totpCode);
          if (!totpOk) throw new Error("Invalid 2FA code");
        }

        return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = (user as any).role ?? "USER"; }
      return token;
    },
    async session({ session, token }) {
      if (session.user) { session.user.id = token.id as string; session.user.role = (token.role as string) ?? "USER"; }
      return session;
    },
  },
  events: {
    async signIn({ user }) { await logAudit({ userId: user.id, action: "auth.login" }); },
    async createUser({ user }) {
      await prisma.subscription.upsert({
        where: { userId: user.id! },
        create: { userId: user.id!, plan: "FREE", status: "ACTIVE" },
        update: {},
      });
      await logAudit({ userId: user.id, action: "auth.signup" });
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
