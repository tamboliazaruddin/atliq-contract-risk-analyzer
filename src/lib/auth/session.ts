// Signed session cookie (HMAC-SHA256 via Web Crypto) — works in middleware (edge) and route handlers (node).

export const SESSION_COOKIE = "atliq_session";
export const SESSION_HOURS = 8;

export type Role = "signer" | "stakeholder";

export interface Session {
  u: string; // username
  n: string; // display name
  r: Role;
  t: string; // title, e.g. "CEO"
  exp: number; // epoch ms
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Prototype demo: if AUTH_SECRET is not configured (e.g. forgotten in Vercel), fall back to a built-in demo
// secret so sign-in still works. Set AUTH_SECRET for anything beyond a demo.
const DEMO_SECRET = "atliq-contract-risk-analyzer-prototype-demo-secret-v1";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 32 ? s : DEMO_SECRET;
}

async function key(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(s: Omit<Session, "exp">): Promise<string> {
  const payload: Session = { ...s, exp: Date.now() + SESSION_HOURS * 3_600_000 };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig) as BufferSource, enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}
