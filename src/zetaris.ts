// Investigator data layer: every reply and its CRM context is read from
// Zetaris (two file sources joined in one federated query). If Zetaris is
// unreachable the agent falls back to the declared snapshot in data/ and
// says so in its output, so a demo never silently changes source.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ReplyRow {
  reply_id: string;
  lead_id: string;
  received_at: string;
  reply_text: string;
  company: string;
  segment: string;
  stage: string;
  channel: string;
  previous_touches: string;
  last_offer: string;
}

export const REPLIES_SQL = `SELECT r.reply_id, r.lead_id, r.received_at, r.reply_text,
  l.company, l.segment, l.stage, l.channel, l.previous_touches, l.last_offer
FROM BEZEN_SALES.replies r JOIN BEZEN_SALES.leads l ON r.lead_id = l.lead_id
ORDER BY r.reply_id`;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} (see .env.example)`);
  return v;
}

async function login(base: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: JSON.stringify({ username: env("ZETARIS_USERNAME"), password: env("ZETARIS_PASSWORD") }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Zetaris login failed: HTTP ${res.status}`);
  const body = await res.json();
  const token = body?.idToken ?? body?.token ?? body?.accessToken ??
    JSON.stringify(body).match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/)?.[0];
  if (typeof token !== "string") throw new Error("Zetaris login returned no token");
  return token;
}

export async function zetarisQuery(sql: string): Promise<Record<string, string>[]> {
  const base = env("ZETARIS_BASE_URL").replace(/\/$/, "");
  const token = await login(base);
  const res = await fetch(`${base}/api/proxy/query/sql/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Org-ID": env("ZETARIS_ORG_ID"),
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({ select: sql, pageLimit: 1000 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Zetaris query failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  // The UI proxy returns { records: [{col: value}], totalCount, ... }.
  const body = (await res.json()) as { records?: Record<string, unknown>[] };
  if (!Array.isArray(body.records)) throw new Error("Zetaris returned no records array");
  return body.records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? "")])));
}

// Minimal CSV reader for the declared fallback snapshot (quoted fields, "" escapes).
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export async function loadReplies(): Promise<{ rows: ReplyRow[]; source: string }> {
  try {
    const rows = (await zetarisQuery(REPLIES_SQL)) as unknown as ReplyRow[];
    return { rows, source: "zetaris:BEZEN_SALES (replies JOIN leads)" };
  } catch (err) {
    const leads = new Map(readCsv(path.join(here, "..", "data", "leads.csv")).map((l) => [l.lead_id, l]));
    const rows = readCsv(path.join(here, "..", "data", "replies.csv")).map((r) => ({ ...leads.get(r.lead_id), ...r })) as unknown as ReplyRow[];
    return { rows, source: `fallback snapshot data/*.csv (Zetaris unavailable: ${(err as Error).message})` };
  }
}
