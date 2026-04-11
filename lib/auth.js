import CredentialsProvider from 'next-auth/providers/credentials';
import bcryptjs from 'bcryptjs';

// Default users - in production, these come from Google Sheets or env
function getUsers() {
  const usersJson = process.env.USERS_JSON;
  if (usersJson) {
    try {
      return JSON.parse(usersJson);
    } catch {
      // fallback to defaults
    }
  }

  return [
    {
      id: '1',
      username: process.env.ADMIN_USERNAME || 'admin',
      password: process.env.ADMIN_PASSWORD_HASH || bcryptjs.hashSync('admin123', 10),
      name: process.env.ADMIN_NAME || 'المدير',
      role: 'admin',
    },
    {
      id: '2',
      username: process.env.USER_USERNAME || 'user',
      password: process.env.USER_PASSWORD_HASH || bcryptjs.hashSync('user123', 10),
      name: process.env.USER_NAME || 'موظف',
      role: 'user',
    },
  ];
}

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'اسم المستخدم', type: 'text' },
        password: { label: 'كلمة المرور', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const users = getUsers();
        const user = users.find((u) => u.username === credentials.username);

        if (!user) return null;

        const isValid = await bcryptjs.compare(credentials.password, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          role: user.role,
          username: user.username,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.username = token.username;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
