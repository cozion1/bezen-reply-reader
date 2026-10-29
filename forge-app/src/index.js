// BEZEN Reply Reader on Forge.
// Rovo is the reader (prompt = the BEZEN layer). These functions are the parts
// that must not be a model: fetching the real reply, the critic, and a
// ledger on the issue where every decision is logged and a human confirms or rejects it.

import api, { route } from "@forge/api";
import Resolver from "@forge/resolver";
import { judge } from "./critic.js";

const LEDGER = "bezen-reply-ledger";

const issueKeyOf = (payload) => payload?.issueKey || payload?.context?.jira?.issueKey;

async function jira(path, init) {
  const res = await api.asApp().requestJira(path, init);
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  const text = await res.text(); // a new issue property comes back 201 with an empty body
  return text ? JSON.parse(text) : null;
}

// The reply to read: the newest comment written by the reporter (the customer),
// else the newest comment, else the request description.
export async function fetchReply(issueKey) {
  const issue = await jira(route`/rest/api/2/issue/${issueKey}?fields=summary,description,reporter`);
  const { comments = [] } = await jira(route`/rest/api/2/issue/${issueKey}/comment?orderBy=-created&maxResults=50`);
  const reporterId = issue.fields.reporter?.accountId;
  const c = comments.find((x) => x.author?.accountId === reporterId) || comments[0];
  return {
    issueKey,
    summary: issue.fields.summary,
    replyId: c ? `comment-${c.id}` : "description",
    author: c?.author?.displayName || issue.fields.reporter?.displayName || "unknown",
    text: plain((c ? c.body : issue.fields.description) || ""),
  };
}

// API v2 returns wiki markup; strip bold/italic/monospace markers so quotes match what the customer typed.
const plain = (s) => s.replace(/\{\{|\}\}/g, "").replace(/(^|[\s(])[*_]+(?=\S)|(?<=\S)[*_]+(?=[\s).,!?:;]|$)/g, "$1").trim();

export async function readLedger(issueKey) {
  const res = await api.asApp().requestJira(route`/rest/api/2/issue/${issueKey}/properties/${LEDGER}`);
  if (res.status === 404) return { entries: [] };
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  return (await res.json()).value;
}

async function writeLedger(issueKey, ledger) {
  await jira(route`/rest/api/2/issue/${issueKey}/properties/${LEDGER}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ledger),
  });
}

// Action: get-customer-reply
export async function getCustomerReply(payload) {
  const issueKey = issueKeyOf(payload);
  if (!issueKey) return "No issue key. Ask the user which request to read.";
  const reply = await fetchReply(issueKey);
  const { entries } = await readLedger(issueKey);
  const memory = entries
    .filter((e) => e.verdict !== "rejected")
    .slice(-5)
    .map((e) => `- ${e.at.slice(0, 10)}: ${e.reading.state}, "${e.reading.evidence}" (${e.human || "not yet reviewed"})`);
  return {
    ...reply,
    memory: memory.length ? memory.join("\n") : "Nothing read on this request before.",
  };
}

// Action: check-reading. The critic runs against the reply fetched here, and
// every decision, pass or fail, is appended to the ledger.
export async function checkReading(payload) {
  const issueKey = issueKeyOf(payload);
  if (!issueKey) return "No issue key. Ask the user which request to read.";
  const reading = {
    sort: payload.sort, state: payload.state, protecting: payload.protecting, evidence: payload.evidence,
    dont: payload.dont, send: payload.send, confidence: Number(payload.confidence ?? 0), message: payload.message ?? "",
  };
  const reply = await fetchReply(issueKey);
  const ledger = await readLedger(issueKey);
  const priorRejections = ledger.entries.filter((e) => e.replyId === reply.replyId && e.verdict === "rejected").length;
  const result = judge(reply.text, reading, priorRejections);

  const entry = {
    id: `${Date.now()}`,
    at: new Date().toISOString(),
    replyId: reply.replyId,
    replyAuthor: reply.author,
    reading: result.escalated ? { ...reading, send: "human", message: "" } : reading,
    verdict: result.verdict,
    problem: result.problem,
    human: null,
  };
  ledger.entries = [...ledger.entries, entry].slice(-50);
  await writeLedger(issueKey, ledger);

  if (result.verdict === "pass") return { verdict: "pass", note: "The quote is in the reply. Show the reading to the user. Do not post anything to the customer; a human confirms it in the BEZEN panel." };
  if (result.verdict === "rejected") return { verdict: "rejected", problem: result.problem, note: "Read the reply again and quote it exactly. You have one more try." };
  return { verdict: "escalated", problem: result.problem, note: "Second rejection. Tell the user a human must read this reply. Do not suggest any message." };
}

// Issue panel: show the ledger, and let the agent on the request confirm or reject a reading.
const resolver = new Resolver();

resolver.define("getLedger", async ({ context }) => {
  const issueKey = context.extension.issue.key;
  const [{ entries }, reply] = await Promise.all([readLedger(issueKey), fetchReply(issueKey)]);
  return { entries: entries.slice().reverse(), reply };
});

resolver.define("review", async ({ payload, context }) => {
  const issueKey = context.extension.issue.key;
  const ledger = await readLedger(issueKey);
  const entry = ledger.entries.find((e) => e.id === payload.id);
  if (!entry || entry.verdict === "rejected") return { ok: false };
  entry.human = payload.decision === "confirm" ? "confirmed" : "rejected by human";
  entry.reviewedBy = context.accountId;
  entry.reviewedAt = new Date().toISOString();
  await writeLedger(issueKey, ledger);
  return { ok: true };
});

export const panel = resolver.getDefinitions();
