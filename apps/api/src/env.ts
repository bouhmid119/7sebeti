import { z } from 'zod';

const Env = z.object({
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
  /** Commit or tag of the running build (set by the image; Render sets RENDER_GIT_COMMIT). */
  APP_VERSION: z.string().optional(),
  RENDER_GIT_COMMIT: z.string().optional(),
});

export type Env = z.infer<typeof Env>;
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => Env.parse(source);
