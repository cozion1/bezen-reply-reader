// Pattern reader (BEZEN layer) + critic.
// The reader names what the person is protecting and MUST quote the exact
// words that show it. The critic is code, not a model: it rejects any reading
// whose quote is not a verbatim substring of the reply, sends it back once
// with the reason, and if it fails again routes the reply to a human instead
// of guessing. That retry-or-escalate loop is the recovery path.

import Anthropic from "@anthropic-ai/sdk";
import type { ReplyRow } from "./zetaris.ts";

export const MODEL = "claude-opus-5-5";

// English port of the existing BEZEN reply-reader skill (declared prior work).
export const BEZEN_SKILL = `You read a prospect's reply to a sales message before it is sorted.
A normal sorter labels it yes / no / question. You go one layer down: what is this person
protecting, what must NOT be done next, and should a bot answer or a human.

Rules
- Read the person, not just the words. One short reply can hide fear of being burned again,
  a sense of intrusion, guilt, or a career on the line.
- "No" on one detail is not a refusal. Only an explicit opt-out, a flat refusal or anger is "no".
- Interest with a delay or a worry is a live lead ("yes").
- Never invent facts about the person. Everything you claim must rest on their own words.

Common states
- burned_before: tried something similar and it failed. Do not pitch; ask what went wrong.
- intrusion: asks where we got their details. Stop selling; offer removal; route to a human.
- guilt_or_loss: emotional stake (family, care). No pressure, no urgency; human, warm.
- price_ultimatum: matches a competitor or walks. Do not cave or argue; clarify what the number protects.
- overloaded: interested but worried about workload. Answer the workload worry first.
- career_risk: they championed it internally. Reduce their personal risk (pilot, exit path).
- flat_no: plain refusal. Respect it; no follow-up.
- casual_yes: low-effort yes. Fine to automate a short, concrete next step.

Output (JSON matching the schema):
- sort: yes | no | question
- state: one of the states above, or "other"
- protecting: one sentence, what the person is protecting
- evidence: the EXACT words from the reply that show it (verbatim substring, no paraphrase)
- dont: one sentence, what must not be done now
- send: auto | human | none
- confidence: 0..1, how sure you are of the reading
- message: the next message to them, 1-3 sentences, no flattery, at most one question, or "" if send is none`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sort", "state", "protecting", "evidence", "dont", "send", "confidence", "message"],
  properties: {
    sort: { type: "string", enum: ["yes", "no", "question"] },
    state: { type: "string" },
    protecting: { type: "string" },
    evidence: { type: "string" },
    dont: { type: "string" },
    send: { type: "string", enum: ["auto", "human", "none"] },
    confidence: { type: "number" },
    message: { type: "string" },
  },
} as const;

export interface Reading {
  sort: "yes" | "no" | "question";
  state: string;
  protecting: string;
  evidence: string;
  dont: string;
  send: "auto" | "human" | "none";
  confidence: number;
  message: string;
}

export interface ReadResult {
  reading: Reading;
  attempts: number;
  critic: string[]; // one line per critic decision
  escalated: boolean;
}

const client = new Anthropic();

async function readOnce(row: ReplyRow, priorMemory: string, correction?: string): Promise<Reading> {
  const context = [
    `Company: ${row.company} (${row.segment}), stage: ${row.stage}, channel: ${row.channel}, previous touches: ${row.previous_touches}, last offer: ${row.last_offer}`,
    priorMemory ? `What memory already holds about this lead:\n${priorMemory}` : "Memory holds nothing about this lead yet.",
    `Reply:\n"""${row.reply_text}"""`,
    correction ? `Your previous reading was rejected by the critic: ${correction}\nQuote the reply exactly this time.` : "",
  ].filter(Boolean).join("\n\n");

  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: BEZEN_SKILL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: context }],
  } as any);

  if (res.stop_reason === "refusal") throw new Error("model declined to read this reply");
  const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return JSON.parse(text) as Reading;
}

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

// Critic: deterministic checks, no model.
export function critique(row: ReplyRow, r: Reading): string | null {
  const quote = norm(r.evidence).replace(/^["']|["']$/g, "");
  if (quote.length < 3) return "evidence is empty";
  if (!norm(row.reply_text).includes(quote)) return `evidence "${r.evidence}" is not in the reply`;
  if (r.send === "auto" && ["intrusion", "guilt_or_loss"].includes(r.state)) return `state ${r.state} must not be auto-sent`;
  if (r.send !== "none" && !r.message.trim()) return "send requires a message";
  return null;
}

export async function readReply(row: ReplyRow, priorMemory: string): Promise<ReadResult> {
  const critic: string[] = [];
  let reading = await readOnce(row, priorMemory);
  let problem = critique(row, reading);
  if (!problem) return { reading, attempts: 1, critic: ["pass on first reading"], escalated: false };

  critic.push(`rejected: ${problem}`);
  reading = await readOnce(row, priorMemory, problem);
  problem = critique(row, reading);
  if (!problem) {
    critic.push("pass after one correction");
    return { reading, attempts: 2, critic, escalated: false };
  }
  critic.push(`rejected again: ${problem} -> escalated to a human, no message sent`);
  return { reading: { ...reading, send: "human", message: "" }, attempts: 2, critic, escalated: true };
}
