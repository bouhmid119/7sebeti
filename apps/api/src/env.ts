import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  RENDER_GIT_COMMIT: z.string().optional(),
});

export type Env = z.infer<typeof Env>;
export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => Env.parse(source);
