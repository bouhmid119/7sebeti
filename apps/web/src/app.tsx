import type { HealthResponse } from '@7sebeti/contracts';
import { useQuery } from '@tanstack/react-query';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/** Placeholder shell until the v2 design lands; shows the API is reachable. */
export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch(`${API_URL}/health`);
      return res.json();
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">7sebeti</h1>
      <p className="text-slate-600">Pilotage de la rentabilité pour le e-commerce COD.</p>
      <p className="text-sm text-slate-500">
        API :{' '}
        {health.isPending
          ? 'vérification…'
          : health.data?.status === 'ok'
            ? `ok (${health.data.version})`
            : 'injoignable'}
      </p>
    </main>
  );
}
