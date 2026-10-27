import https from "node:https";
import http from "node:http";
import { readDB, writeDB, type Check, type Site } from "./db";

const MAX_CHECKS = 20000;

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SitePulse/1.0",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** spec like "200-399,500". Default: 200-399 counts as OK. */
export function accepts(status: number, spec?: string) {
  const parts = (spec?.trim() || "200-399")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.some((p) => {
    const [a, b] = p.split("-").map(Number);
    return b !== undefined ? status >= a && status <= b : status === a;
  });
}

const CERT_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "ERR_CERT_AUTHORITY_INVALID",
]);

/** Returns the certificate/TLS error code if the error is about trust or the TLS handshake. */
function certErrorCode(e: any): string | null {
  for (const x of [e, e?.cause, e?.cause?.cause]) {
    const code = x?.code as string | undefined;
    if (
      code &&
      (CERT_CODES.has(code) || /^ERR_(TLS|SSL)/.test(code) || /CERT/.test(code))
    )
      return code;
    if (x?.message && /self.signed|certificate|ssl|tls/i.test(x.message))
      return code || "TLS_ERROR";
  }
  return null;
}

/** Every message in the error chain, e.g. "fetch failed" caused by "[ECONNREFUSED] connect ...". */
function fullError(e: any): string {
  const parts: string[] = [];
  for (let x = e, n = 0; x && n < 5; x = x.cause, n++) {
    const code = x.code ? `[${x.code}] ` : "";
    parts.push(
      `${x.name && x.name !== "Error" ? x.name + ": " : ""}${code}${x.message ?? String(x)}`,
    );
  }
  return parts.join("\n  caused by: ");
}

/** Plain-text preview of an error page body. */
function snippet(t: string) {
  return t
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/** Request that ignores certificate errors (used only after a certificate error was seen). */
function insecureGet(
  url: string,
  hops = 0,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib: any = u.protocol === "https:" ? https : http;
    const req = lib.request(
      u,
      {
        method: "GET",
        rejectUnauthorized: false,
        timeout: 15000,
        headers: HEADERS,
      },
      (res: http.IncomingMessage) => {
        const loc = res.headers.location;
        const st = res.statusCode ?? 0;
        if (st >= 300 && st < 400 && loc && hops < 5) {
          res.resume();
          return resolve(insecureGet(new URL(loc, u).toString(), hops + 1));
        }
        const chunks: Buffer[] = [];
        let len = 0;
        res.on("data", (d: Buffer) => {
          if (len < 4000) {
            chunks.push(d);
            len += d.length;
          }
        });
        res.on("end", () =>
          resolve({ status: st, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(
        Object.assign(new Error("Timeout (15s)"), { name: "TimeoutError" }),
      ),
    );
    req.on("error", reject);
    req.end();
  });
}

const reasonOf = (e: any) =>
  String(
    e?.name === "TimeoutError"
      ? "Timeout (15s)"
      : e?.cause?.code || e?.code || e?.message || "Unreachable",
  );

export async function ping(
  url: string,
  okCodes?: string,
  ignoreCert?: boolean,
): Promise<Omit<Check, "siteId" | "ts">> {
  const t = Date.now();

  // Self-signed mode: never verify the certificate, never warn.
  if (ignoreCert) {
    try {
      const { status, body } = await insecureGet(url);
      const ok = status > 0 && accepts(status, okCodes);
      if (ok) return { ok, code: status, ms: Date.now() - t };
      const b = snippet(body);
      return {
        ok,
        code: status,
        ms: Date.now() - t,
        error: `HTTP ${status}`,
        detail: b
          ? `Server response:\n${b}`
          : "The server sent an empty response body.",
      };
    } catch (e: any) {
      return {
        ok: false,
        code: 0,
        ms: Date.now() - t,
        error: reasonOf(e),
        detail: fullError(e),
      };
    }
  }

  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
      cache: "no-store",
      headers: HEADERS,
    });
    const ok = accepts(r.status, okCodes);
    if (ok) {
      r.body?.cancel().catch(() => {});
      return { ok, code: r.status, ms: Date.now() - t };
    }
    const body = snippet(await r.text().catch(() => ""));
    return {
      ok,
      code: r.status,
      ms: Date.now() - t,
      error: `HTTP ${r.status} ${r.statusText}`.trim(),
      detail: body
        ? `Server response:\n${body}`
        : "The server sent an empty response body.",
    };
  } catch (e: any) {
    let original = e;
    const certCode = certErrorCode(e);
    if (certCode) {
      // Certificate problem is a warning, not downtime: re-check without verifying it.
      try {
        const { status, body } = await insecureGet(url);
        const ok = status > 0 && accepts(status, okCodes);
        const b = ok ? "" : snippet(body);
        const note = ok
          ? "Warning only: the certificate is not trusted, but the site responded normally, so it is counted as online."
          : `The certificate is not trusted (warning only). The site is down because it returned HTTP ${status}.`;
        return {
          ok,
          code: status,
          ms: Date.now() - t,
          warning: `Certificate not trusted (${certCode})`,
          error: ok ? undefined : `HTTP ${status}`,
          detail:
            `${note}\n\nCertificate error: ${fullError(e)}` +
            (b ? `\n\nServer response:\n${b}` : ""),
        };
      } catch (e2: any) {
        original = e2;
      }
    }
    return {
      ok: false,
      code: 0,
      ms: Date.now() - t,
      error: reasonOf(original),
      detail: fullError(original),
    };
  }
}

/** Check sites (active + inactive by default, or one by id) and store results. */
export async function runChecks(onlyId?: string) {
  const snapshot = await readDB();
  const targets = snapshot.sites.filter((s) =>
    onlyId ? s.id === onlyId : s.status !== "disabled",
  );
  const ts = Date.now();
  const results = await Promise.all(
    targets.map(async (s) => ({
      id: s.id,
      r: await ping(s.url, s.okCodes, s.ignoreCert),
    })),
  );

  const db = await readDB(); // re-read so edits made meanwhile are not lost
  for (const { id, r } of results) {
    const s: Site | undefined = db.sites.find((x) => x.id === id);
    if (!s) continue;
    db.checks.push({ siteId: id, ts, ...r });
    s.lastCheck = ts;
    s.lastMs = r.ms;
    s.lastCode = r.code;
    s.lastError = r.error;
    s.lastWarning = r.warning;
    s.lastDetail = r.detail;
    s.downSince = r.ok
      ? undefined
      : s.health === "down"
        ? (s.downSince ?? ts)
        : ts;
    s.health = r.ok ? "up" : "down";
  }
  if (db.checks.length > MAX_CHECKS) db.checks = db.checks.slice(-MAX_CHECKS);
  await writeDB(db);
}

const g = globalThis as unknown as { __pulse?: NodeJS.Timeout };
export function startScheduler() {
  if (g.__pulse) return;
  runChecks().catch(console.error);
  g.__pulse = setInterval(() => runChecks().catch(console.error), 60_000);
  console.log("[SitePulse] monitor started: checking every 60s");
}
