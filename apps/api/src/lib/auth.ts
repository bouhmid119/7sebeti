import { type Db, schema } from '@7sebeti/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins/two-factor';

export interface AuthConfig {
  db: Db;
  secret: string;
  apiUrl: string;
  appUrl: string;
  production: boolean;
}

/**
 * Email + password sessions in httpOnly cookies (SameSite=Lax: app.7sebeti.com and
 * api.7sebeti.com are the same site). TOTP two-factor is available; making it mandatory
 * for owners is enforced at the organization level later. Email verification waits for
 * the transactional email provider decision.
 */
export function createAuth({ db, secret, apiUrl, appUrl, production }: AuthConfig): Auth {
  const auth = betterAuth({
    appName: '7sebeti',
    secret,
    baseURL: apiUrl,
    basePath: '/api/auth',
    trustedOrigins: [appUrl],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    plugins: [twoFactor({ issuer: '7sebeti' })],
    telemetry: { enabled: false },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'sebeti',
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production },
    },
  });
  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const session = await auth.api.getSession({ headers });
      return session ? { userId: session.user.id } : null;
    },
  };
}

/** The slice of Better Auth the API uses (keeps the library types out of public signatures). */
export interface Auth {
  handler: (request: Request) => Promise<Response>;
  getSession: (headers: Headers) => Promise<{ userId: string } | null>;
}
