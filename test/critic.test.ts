// The critic is the part that makes the agent trustworthy, so it is tested
// without any model or network: a paraphrased "quote" must be rejected.
import test from "node:test";
import assert from "node:assert/strict";
import { critique, type Reading } from "../src/reader.ts";
import type { ReplyRow } from "../src/zetaris.ts";

const row = {
  reply_id: "R08", lead_id: "L008", received_at: "", company: "Atlas Fitness", segment: "smb",
  stage: "demo_done", channel: "email", previous_touches: "3", last_offer: "pilot month",
  reply_text: "I'm the one who pushed for this internally. If it flops my boss will remember. What happens if it doesn't work?",
} as ReplyRow;

const base: Reading = {
  sort: "yes", state: "career_risk", protecting: "their standing", evidence: "If it flops my boss will remember",
  dont: "push", send: "human", confidence: 0.9, message: "A one-month pilot you can stop any day.",
};

test("accepts a verbatim quote (case and curly quotes ignored)", () => {
  assert.equal(critique(row, { ...base, evidence: "“if it flops MY boss will remember”" }), null);
});

test("rejects a paraphrase presented as evidence", () => {
  assert.match(critique(row, { ...base, evidence: "my manager will blame me" }) ?? "", /not in the reply/);
});

test("rejects empty evidence", () => {
  assert.match(critique(row, { ...base, evidence: "" }) ?? "", /empty/);
});

test("rejects evidence longer than the reply or a single word", () => {
  assert.match(critique(row, { ...base, evidence: "flops" }) ?? "", /shorter than 2 words/);
  assert.match(critique(row, { ...base, evidence: row.reply_text + " and more" }) ?? "", /longer than the reply/);
});

test("never auto-sends to an intrusion or guilt state", () => {
  assert.match(critique(row, { ...base, state: "intrusion", send: "auto" }) ?? "", /must not be auto-sent/);
});
