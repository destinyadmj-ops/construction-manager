type TokenCache = { accessToken: string; expiresAtMs: number };

let tokenCache: TokenCache | null = null;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`${name} is not set`);
  return v;
}

export async function getGraphAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs - 30_000 > now) return tokenCache.accessToken;

  const tenantId = requiredEnv('OUTLOOK_TENANT_ID');
  const clientId = requiredEnv('OUTLOOK_CLIENT_ID');
  const clientSecret = requiredEnv('OUTLOOK_CLIENT_SECRET');

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'client_credentials');
  body.set('scope', 'https://graph.microsoft.com/.default');

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const err = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Graph token error: ${String(err)}`);
  }

  const accessToken = typeof json?.access_token === 'string' ? json.access_token : null;
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 0;
  if (!accessToken) throw new Error('Graph token missing access_token');

  tokenCache = { accessToken, expiresAtMs: now + Math.max(60, expiresIn) * 1000 };
  return accessToken;
}

export type SendMailAttachment = {
  name: string;
  contentType: string;
  contentBytesBase64: string;
};

export async function sendGraphMail(args: {
  fromUser: string;
  to: string[];
  subject: string;
  bodyText: string;
  attachments?: SendMailAttachment[];
}): Promise<void> {
  const token = await getGraphAccessToken();

  const attachments = (args.attachments ?? []).map((a) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: a.name,
    contentType: a.contentType,
    contentBytes: a.contentBytesBase64,
  }));

  const payload = {
    message: {
      subject: args.subject,
      body: { contentType: 'Text', content: args.bodyText },
      toRecipients: args.to.map((address) => ({ emailAddress: { address } })),
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    saveToSentItems: true,
  };

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(args.fromUser)}/sendMail`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed: HTTP ${res.status} ${text}`);
  }
}
