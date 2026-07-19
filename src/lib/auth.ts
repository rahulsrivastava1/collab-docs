import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { findUserByEmail, findUserById, upsertGoogleUser } from "@/lib/users";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "Email and Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || !password) {
          return null;
        }

        const user = await findUserByEmail(email);
        if (!user?.password_hash) {
          return null;
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          authVersion: user.auth_version ?? 1,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!user.email) {
          return false;
        }

        const dbUser = await upsertGoogleUser({
          email: user.email,
          name: user.name,
          image: user.image,
        });
        user.id = dbUser.id;
        user.authVersion = dbUser.auth_version ?? 1;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.authVersion = user.authVersion ?? 1;
        return token;
      }

      if (!token.sub) {
        return token;
      }

      // Reject sessions invalidated after auth_version changes.
      const dbUser = await findUserById(token.sub);
      if (!dbUser) {
        return { ...token, sub: undefined, authVersion: undefined };
      }

      if ((dbUser.auth_version ?? 1) !== (token.authVersion ?? 1)) {
        return { ...token, sub: undefined, authVersion: undefined };
      }

      token.email = dbUser.email;
      token.name = dbUser.name;
      token.picture = dbUser.image;
      token.authVersion = dbUser.auth_version ?? 1;
      return token;
    },
    async session({ session, token }) {
      if (!token.sub) {
        // Force clients to treat this as signed out when the JWT is invalidated.
        session.user = {
          id: "",
          email: undefined,
          name: undefined,
          image: undefined,
        };
        return session;
      }

      if (session.user) {
        session.user.id = token.sub;
        session.user.email = token.email as string | undefined;
        session.user.name = token.name as string | null | undefined;
        session.user.image = token.picture as string | null | undefined;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
