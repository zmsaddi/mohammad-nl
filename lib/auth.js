import CredentialsProvider from 'next-auth/providers/credentials';
import bcryptjs from 'bcryptjs';
import { getUserByUsername } from './db';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'اسم المستخدم', type: 'text' },
        password: { label: 'كلمة المرور', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        try {
          const user = await getUserByUsername(credentials.username);
          if (!user) return null;
          if (!user.active) return null;

          const isValid = await bcryptjs.compare(credentials.password, user.password);
          if (!isValid) return null;

          return {
            id: String(user.id),
            name: user.name,
            role: user.role,
            username: user.username,
          };
        } catch {
          // DB unreachable — deny all logins. The default admin row (created by
          // initDatabase) will be available once the DB recovers. A hardcoded
          // fallback would be a permanent backdoor, so it has been removed.
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.username = token.username;
      }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
