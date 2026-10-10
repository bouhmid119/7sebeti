import { z } from 'zod';

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().url(),
    APP_URL: z.string().url().default('http://localhost:5173'),
    API_URL: z.string().url().default('http://localhost:4000'),
    /** Signs session cookies. openssl rand -base64 32 */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Keyring for integration secrets: "v1:<base64 32 bytes>[;v2:…]". */
    ENCRYPTION_KEY: z.string().min(1),
    /** Keyring wrapping each organization's data key (personal data, raw payloads). */
    DATA_MASTER_KEY: z.string().min(1),
    /** Resend API key; required in production. Without it, e-mails are skipped (dev, CI). */
    RESEND_API_KEY: z.string().optional(),
    /** Sender on the Resend-verified domain. */
    EMAIL_FROM: z.string().default('7sebeti <no-reply@7sebeti.com>'),
    /** Commit of the running build (set by the image at build time). */
    APP_VERSION: z.string().optional(),
  })
  .refine((e) => e.NODE_ENV !== 'production' || Boolean(e.RESEND_API_KEY), {
    message: 'RESEND_API_KEY est obligatoire en production',
    path: ['RESEND_API_KEY'],
  });

export type Env = z.infer<typeof Env>;
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => Env.parse(source);
