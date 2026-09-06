/**
 * Firebase Cloud Messaging, HTTP v1.
 *
 * Chosen over Expo or a direct APNs integration because one provider covers
 * iOS, Android and web push, and `devices.platform` already carries all three.
 * A school that wants a different provider writes a second file; nothing else
 * in the codebase learns about it.
 *
 * WHAT MAKES THIS HARDER THAN RESEND OR TWILIO
 *
 * There is no API key. FCM v1 authenticates with a Google service account:
 * this signs a JWT with the account's RSA private key, exchanges it for an
 * OAuth access token, and sends that. The token lasts an hour, so it is cached
 * in module scope for the life of the isolate -- fetching one per message would
 * triple the request count for no benefit.
 *
 * The credentials are one env var holding the service-account JSON, exactly as
 * Google emits it. Splitting it into three variables invites somebody to paste
 * a private key with its newlines mangled, which fails at signing time with a
 * message that explains nothing.
 */

export type FcmCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function readCredentials(): FcmCredentials | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      // Google's JSON carries real newlines, but a value pasted through a shell
      // or a secrets UI often arrives with them escaped. Accepting both is one
      // line here and saves an afternoon of "invalid key format".
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** PEM -> the raw PKCS#8 bytes `crypto.subtle.importKey` wants. */
function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * An OAuth access token for the messaging scope, cached until a minute before
 * it expires. The minute of headroom is not superstition: a token that expires
 * mid-batch turns the rest of that batch into 401s, and a 401 looks exactly
 * like a permanently dead token unless you read the body.
 */
export async function accessTokenFor(credentials: FcmCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: credentials.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${encodeJson(header)}.${encodeJson(claims)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(credentials.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    // Cache nothing on failure: the next message should try again rather than
    // reuse a token that was never issued.
    throw new Error(`FCM auth failed: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) };
  return payload.access_token;
}

/**
 * Which FCM errors mean *this token is gone* rather than *try again*.
 *
 * This is the whole reason push needed a `permanent` flag. A rotated or
 * uninstalled token answers the same way for ever, so retrying it five times
 * with exponential backoff costs five requests and five lines of noise in a
 * delivery log, per message, until somebody notices. `UNREGISTERED` and a
 * malformed token are dead; a quota error and a 503 are not.
 */
export function isPermanentFailure(status: number, body: string): boolean {
  if (status === 404) return true; // the token is not registered
  if (status === 400 && /INVALID_ARGUMENT|registration-token-not-registered/i.test(body)) {
    return true;
  }
  if (status === 403 && /SenderId mismatch|MismatchSenderId/i.test(body)) {
    // The token belongs to a different Firebase project -- it will never work
    // from this deployment, however many times it is tried.
    return true;
  }
  return /UNREGISTERED|NOT_FOUND/i.test(body) && status < 500;
}
