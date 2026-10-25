// BEZEN Reply Reader: an agent that explains WHY a sales reply needs the answer it gets.
//
//   npx tsx agent.ts run              read every reply from Zetaris, explain it, remember it
//   npx tsx agent.ts why <lead_id>    trace a decision: quote, source, confidence, ledger
//   npx tsx agent.ts approve <mem-id> a human confirms a reading (H-MEM feedback: helpful)
//   npx tsx agent.ts reject <mem-id>  a human marks a reading wrong (H-MEM feedback: wrong)
//
// Roles (each is real code, not a persona):
//   investigator  src/zetaris.ts   federated query over two Zetaris sources
//   reader        src/reader.ts    BEZEN pattern layer on Claude, must quote its evidence
//   critic        src/reader.ts    deterministic check; retry once, else escalate to a human
//   memory        H-MEM (Meterless) every finding stored with source, confidence and ledger
//   reporter      this file         out/report.md for the human who decides

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHMEM } from "./src/engine.ts";
import { loadReplies, type ReplyRow } from "./src/zetaris.ts";
import { readReply, MODEL, type ReadResult } from "./src/reader.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const file = path.join(here, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const memoryFor = (hmem: any, leadId: string) =>
  hmem.store.all().filter((m: any) => m.tags.includes(leadId) && !m.supersededBy);

async function run(hmem: any): Promise<void> {
  const { rows, source } = await loadReplies();
  console.log(`source: ${source} | ${rows.length} replies | model: ${MODEL}\n`);
  const results: { row: ReplyRow; res: ReadResult; memId: string }[] = [];

  for (const row of rows) {
    const prior = memoryFor(hmem, row.lead_id);
    const priorText = prior.map((m: any) => `- ${m.content}`).join("\n");
    const res = await readReply(row, priorText);
    const r = res.reading;
    const record = hmem.add({
      content: `${row.company} (${row.lead_id}) is protecting: ${r.protecting} Evidence: "${r.evidence}". Do not: ${r.dont}`,
      type: "factual",
      tags: [row.lead_id, row.reply_id, r.state, `send:${r.send}`],
      confidence: Math.max(0.05, Math.min(1, r.confidence)) * (res.escalated ? 0.5 : 1),
      source: `zetaris:BEZEN_SALES.replies#${row.reply_id}`,
      provenance: { origin: "document", learnedAt: Date.now(), label: `reply ${row.reply_id} via ${source.split(" ")[0]}`, refs: [row.reply_id, row.lead_id] },
      supersedes: prior[0]?.id,
    });
    results.push({ row, res, memId: record.id });
    const flag = res.escalated ? "ESCALATED" : r.send.toUpperCase();
    console.log(`${row.reply_id} ${row.company.padEnd(22)} ${r.state.padEnd(16)} ${flag.padEnd(9)} ${record.id}  critic: ${res.critic.join("; ")}`);
  }

  fs.mkdirSync(path.join(here, "out"), { recursive: true });
  const lines = [
    "# BEZEN Reply Reader report",
    "",
    `Source: ${source}  `,
    `Model: ${MODEL}  `,
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Reply | Company | Sort | State | Send | Evidence (verbatim) | Memory |",
    "|---|---|---|---|---|---|---|",
    ...results.map(({ row, res, memId }) =>
      `| ${row.reply_id} | ${row.company} | ${res.reading.sort} | ${res.reading.state} | ${res.escalated ? "human (escalated)" : res.reading.send} | "${res.reading.evidence.replace(/\|/g, "/")}" | ${memId} |`),
    "",
    ...results.flatMap(({ row, res, memId }) => [
      `## ${row.reply_id} - ${row.company}`,
      `> ${row.reply_text}`,
      "",
      `- **Protecting:** ${res.reading.protecting}`,
      `- **Do not:** ${res.reading.dont}`,
      `- **Next message:** ${res.reading.message || "(none, a human decides)"}`,
      `- **Critic:** ${res.critic.join("; ")}`,
      `- **Trace:** \`npx tsx agent.ts why ${row.lead_id}\` (memory ${memId})`,
      "",
    ]),
  ];
  fs.writeFileSync(path.join(here, "out", "report.md"), lines.join("\n"));
  console.log(`\nreport: out/report.md | memory: .hmem/ | trace any lead: npx tsx agent.ts why <lead_id>`);
}

function why(hmem: any, leadId: string): void {
  const mems = hmem.store.all().filter((m: any) => m.tags.includes(leadId));
  if (!mems.length) return console.log(`nothing in memory for ${leadId}; run: npx tsx agent.ts run`);
  for (const m of mems) {
    console.log(`${m.id}${m.supersededBy ? ` (superseded by ${m.supersededBy})` : ""}`);
    console.log(`  claim:      ${m.content}`);
    console.log(`  source:     ${m.source}`);
    console.log(`  confidence: ${m.confidence.toFixed(2)}`);
    console.log(`  ledger:`);
    for (const e of hmem.ledger.history(m.id)) {
      const conf = e.newState?.confidence !== undefined && e.previousState?.confidence !== undefined
        ? ` confidence ${e.previousState.confidence.toFixed(2)} -> ${e.newState.confidence.toFixed(2)}` : "";
      console.log(`    - ${e.action} at ${new Date(e.timestamp).toISOString()}${conf}`);
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command, arg] = process.argv.slice(2);
  const { HMEM, source } = await loadHMEM();
  const hmem = new HMEM({ persistDir: path.join(here, ".hmem") });
  if (command === "run") return run(hmem);
  if (command === "why" && arg) return why(hmem, arg);
  if ((command === "approve" || command === "reject") && arg) {
    hmem.feedback(arg, command === "approve" ? "helpful" : "wrong");
    console.log(`${arg}: human ${command === "approve" ? "approved" : "rejected"} (ledger updated)`);
    return why(hmem, hmem.store.get(arg)?.tags[0] ?? arg);
  }
  console.log(`BEZEN Reply Reader (memory engine: H-MEM, ${source})
  npx tsx agent.ts run
  npx tsx agent.ts why <lead_id>
  npx tsx agent.ts approve|reject <memory-id>`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
