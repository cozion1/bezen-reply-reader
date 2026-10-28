// The critic is what makes the agent trustworthy, so it is tested with no
// model, no Jira and no network.
import test from "node:test";
import assert from "node:assert/strict";
import { critique, judge } from "../src/critic.js";

const reply = "I'm the one who pushed for this internally. If it flops my boss will remember. What happens if it doesn't work?";

const base = {
  sort: "yes", state: "career_risk", protecting: "their standing", evidence: "If it flops my boss will remember",
  dont: "push", send: "human", confidence: 0.9, message: "A one-month pilot you can stop any day.",
};

test("accepts a verbatim quote (case and curly quotes ignored)", () => {
  assert.equal(critique(reply, { ...base, evidence: "“if it flops MY boss will remember”" }), null);
});

test("rejects a paraphrase presented as evidence", () => {
  assert.match(critique(reply, { ...base, evidence: "my manager will blame me" }), /not in the reply/);
});

test("rejects empty, one-word and over-long evidence", () => {
  assert.match(critique(reply, { ...base, evidence: "" }), /empty/);
  assert.match(critique(reply, { ...base, evidence: "flops" }), /shorter than 2 words/);
  assert.match(critique(reply, { ...base, evidence: reply + " and more" }), /longer than the reply/);
});

test("never auto-answers an intrusion or guilt state", () => {
  assert.match(critique(reply, { ...base, state: "intrusion", send: "auto" }), /must not be auto-sent/);
  assert.match(critique(reply, { ...base, state: "guilt_or_loss", send: "auto" }), /must not be auto-sent/);
});

test("an answer needs a message, silence does not", () => {
  assert.match(critique(reply, { ...base, message: " " }), /requires a message/);
  assert.equal(critique(reply, { ...base, send: "none", message: "" }), null);
});

test("one retry, then a human: the count comes from the ledger, not the agent", () => {
  const bad = { ...base, evidence: "my manager will blame me" };
  assert.equal(judge(reply, bad, 0).verdict, "rejected");
  assert.deepEqual(judge(reply, bad, 1), { verdict: "escalated", problem: critique(reply, bad), escalated: true });
  assert.equal(judge(reply, base, 1).verdict, "pass");
});
