// Critic: deterministic checks, no model. Same rules as ../../src/reader.ts.
// The reply it checks against is fetched from Jira by the app itself, never
// taken from the agent's input, so the agent cannot quote text that is not there.

export const SENSITIVE_STATES = ["intrusion", "guilt_or_loss"];

const norm = (s) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

export function critique(replyText, r) {
  const quote = norm(r.evidence).replace(/^["']|["']$/g, "");
  const reply = norm(replyText);
  if (quote.length < 3) return "evidence is empty";
  if (quote.split(" ").length < 2) return "evidence is shorter than 2 words";
  if (quote.length > reply.length) return "evidence is longer than the reply";
  if (!reply.includes(quote)) return `evidence "${r.evidence}" is not in the reply`;
  if (r.send === "auto" && SENSITIVE_STATES.includes(r.state)) return `state ${r.state} must not be auto-sent`;
  if (r.send !== "none" && !String(r.message ?? "").trim()) return "send requires a message";
  return null;
}

// One reading per reply. A first rejection allows one retry; a second rejection
// escalates to a human with no message. The count lives in the ledger, so the
// agent cannot reset it by asking again.
export function judge(replyText, reading, priorRejections) {
  const problem = critique(replyText, reading);
  if (!problem) return { verdict: "pass", problem: null, escalated: false };
  if (priorRejections >= 1) return { verdict: "escalated", problem, escalated: true };
  return { verdict: "rejected", problem, escalated: false };
}
