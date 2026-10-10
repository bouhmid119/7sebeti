/**
 * Transactional e-mail through Resend (domain created in region eu-west-1).
 *
 * Resend keeps account data in the United States, so these e-mails only ever carry
 * the merchant user's own address and a link: never a customer name, phone or order.
 */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendEmail = (email: Email) => Promise<void>;

export interface MailerConfig {
  apiKey?: string;
  from: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export function createMailer({
  apiKey,
  from,
  fetch: doFetch = fetch,
  log = console.log,
}: MailerConfig): SendEmail {
  if (!apiKey) {
    // Local / CI: no provider. Never log the recipient or the link (it is a credential).
    return async (email) => log(`[mail] RESEND_API_KEY absent, e-mail non envoyé : ${email.subject}`);
  }
  return async (email) => {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend a refusé l'envoi (${res.status})`);
  };
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function linkEmail(to: string, subject: string, intro: string, action: string, url: string): Email {
  const safeUrl = escapeHtml(url);
  return {
    to,
    subject,
    text: `${intro}\n\n${action} : ${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\n7sebeti`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${safeUrl}">${escapeHtml(action)}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p><p>7sebeti</p>`,
  };
}

export const emails = {
  verifyAddress: (to: string, url: string) =>
    linkEmail(to, 'Confirmez votre adresse e-mail', 'Bienvenue sur 7sebeti.', 'Confirmer mon adresse', url),
  resetPassword: (to: string, url: string) =>
    linkEmail(
      to,
      'Réinitialisation de votre mot de passe',
      'Vous avez demandé à changer votre mot de passe 7sebeti. Ce lien expire dans une heure.',
      'Choisir un nouveau mot de passe',
      url,
    ),
};
