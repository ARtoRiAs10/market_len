import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

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
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) throw new Error("Email and password required");
        const user = await prisma.user.findUnique({ where: { email: credentials.email.toLowerCase().trim() } });
        if (!user || !user.passwordHash) throw new Error("Invalid email or password");
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) throw new Error("Invalid email or password");
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
