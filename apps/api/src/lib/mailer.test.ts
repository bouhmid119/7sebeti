import { describe, expect, it, vi } from 'vitest';
import { createMailer, emails } from './mailer';

describe('mailer', () => {
  it('sends through Resend with the configured sender', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const send = createMailer({ apiKey: 're_test', from: '7sebeti <no-reply@7sebeti.com>', fetch });
    await send(emails.resetPassword('owner@shop.tn', 'https://api.7sebeti.com/reset?token=abc'));

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: '7sebeti <no-reply@7sebeti.com>', to: ['owner@shop.tn'] });
    expect(body.html).toContain('href="https://api.7sebeti.com/reset?token=abc"');
  });

  it('fails loudly when Resend refuses', async () => {
    const send = createMailer({
      apiKey: 're_test',
      from: 'x@7sebeti.com',
      fetch: async () => new Response('', { status: 422 }),
    });
    await expect(send(emails.verifyAddress('a@b.tn', 'https://x'))).rejects.toThrow('422');
  });

  it('without a key, logs only the subject (never the address or the link)', async () => {
    const lines: string[] = [];
    const send = createMailer({ from: 'x@7sebeti.com', log: (l) => lines.push(l) });
    await send(emails.resetPassword('owner@shop.tn', 'https://x/reset?token=secret'));
    expect(lines.join()).toContain('Réinitialisation');
    expect(lines.join()).not.toContain('owner@shop.tn');
    expect(lines.join()).not.toContain('secret');
  });

  it('escapes HTML in links', () => {
    expect(emails.verifyAddress('a@b.tn', 'https://x/?a=1&b="2"').html).toContain('a=1&amp;b=&quot;2&quot;');
  });
});
