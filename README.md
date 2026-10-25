# BEZEN Reply Reader

**An agent that explains *why* a sales reply needs the answer it gets, and proves every claim with the person's own words.**

Open Agent Hackathon 2026 · Wildcard [Tinkerer] track · Team BEZEN (solo: Zion Cohen)

---

## The five questions

| | |
|---|---|
| **Who is the user?** | A sales rep (or sales-ops lead) whose outbound bot already sorts replies into *yes / no / question*. |
| **What is the problem?** | The bot answers what was written, not what the person is protecting, so it sends the wrong next message and burns live leads. |
| **What goes in?** | Prospect replies and CRM lead records, held in two separate sources and queried through **Zetaris**. |
| **What comes out?** | For each reply: what the person is protecting, the exact words that show it, what must not be done now, whether a bot may answer or a human must, and the next message. Every finding is remembered with its source. |
| **Why an agent?** | One prompt can label a reply. It cannot check its own evidence, retry when the evidence is fake, escalate when it still fails, and remember each lead across runs with an audit trail. That loop is the product. |

## What it looks like

```
$ npx tsx agent.ts run
source: zetaris:BEZEN_SALES (replies JOIN leads) | 8 replies | model: claude-opus-5-5

R01 Harbor Dental          burned_before    HUMAN     mem-1  critic: pass on first reading
R02 Northwind Logistics    intrusion        HUMAN     mem-2  critic: pass on first reading
R03 Maple Senior Living    guilt_or_loss    HUMAN     mem-3  critic: pass on first reading
R04 Quartz Accounting      flat_no          NONE      mem-4  critic: pass on first reading
R07 Lumen Yoga Studio      casual_yes       AUTO      mem-7  critic: pass on first reading
R08 Atlas Fitness          career_risk      HUMAN     mem-8  critic: pass on first reading
...
$ npx tsx agent.ts why L008
mem-8
  claim:      Atlas Fitness (L008) is protecting: their standing with their boss after championing
              this purchase internally. Evidence: "If it flops my boss will remember".
  source:     zetaris:BEZEN_SALES.replies#R08
  confidence: 0.88
  ledger:     - create at 2026-10-25T02:48:13Z
```

A normal sorter sees *"Where did you get my email address?"* as a question and keeps selling. This agent reads **intrusion**, stops the pitch, offers removal, and routes it to a human. The full output for all eight replies is written to `out/report.md`.

## How it works

```
Zetaris (two file sources)          Claude + BEZEN layer          code critic                 H-MEM (Meterless)
  BEZEN_SALES.replies  ─┐
                        ├─ JOIN ─▶  reader: state, protecting, ─▶ evidence verbatim? ─ yes ─▶ store finding with
  BEZEN_SALES.leads   ──┘           evidence, send, message       auto-send allowed?          source, confidence,
        ▲                                   ▲                     │ no                        provenance, ledger
        │                                   └──── retry once ◀────┤                                 │
        └──── investigator                                         └─ fails again ─▶ human, no message
                                                       prior memory for the lead ◀───────────────────┘
```

| Role | Code | What is real about it |
|---|---|---|
| Investigator | `src/zetaris.ts` | Logs in to Zetaris and runs one federated `JOIN` across two registered file sources. |
| Reader (BEZEN) | `src/reader.ts` | Claude with the BEZEN pattern layer and a strict JSON schema. It must quote its evidence. |
| Critic | `src/reader.ts` → `critique()` | Deterministic code, not a model. It rejects a quote that is not verbatim in the reply, and blocks auto-send for intrusion or guilt states. On rejection the reader retries once with the reason; a second failure goes to a human with no message sent. |
| Memory | H-MEM via `src/engine.ts` | Each finding is stored with `source`, `confidence`, provenance and an append-only ledger. Prior findings for the same lead are fed back into the next reading, and a new finding supersedes the old one. |
| Human approval | `agent.ts approve / reject` | The rep confirms or rejects a reading; H-MEM feedback adjusts its confidence in the ledger. |

## Sponsor technology

### Zetaris (data layer)
- Local Zetaris platform (Docker Compose bundle from Zetaris Cloud Gateway), all 9 `verify.sh` checks passing.
- A Lightning database `BEZEN_SALES` with two `LIGHTNING FILESTORE` CSV tables, `leads` and `replies`. The exact SQL is in [`data/zetaris_setup.sql`](data/zetaris_setup.sql).
- The agent queries them in place through the Zetaris UI proxy (`/api/auth/login`, then `/api/proxy/query/sql/start`). Nothing is copied into the agent first.
- **Fallback:** if Zetaris is unreachable, the agent reads the declared snapshot in `data/*.csv` and prints that it did so on the first line of output.

### Meterless (memory layer): engine used, H-MEM
| H-MEM service | Where | Used for |
|---|---|---|
| MemoryStoreService | `agent.ts run` | `add()` with mandatory `source` + `confidence`, provenance, tags, `supersedes` |
| TrustLedgerService | `agent.ts why` | full append-only history of each finding |
| Retrieval feedback | `agent.ts approve / reject` | `feedback(id, "helpful" / "wrong")`, which shifts confidence in the ledger |
| Store query by lead | `memoryFor()` | prior readings for a lead are fed into the next reading |

### Cursor
Developed in Cursor (Cursor Agent CLI used on this repository during the build window). See commit history.

## Run it from zero

Requirements: Node 18+, Docker Desktop, a Zetaris Cloud account (for the local bundle), an Anthropic API key.

```bash
git clone <this repo> && cd bezen-reply-memory
npm install
npm run setup                    # vendors the Meterless H-MEM reference engine into vendor/
cp .env.example .env             # fill in Zetaris user/password/org and ANTHROPIC_API_KEY
```

Load the two sources into your Zetaris instance: copy `data/leads.csv` and `data/replies.csv` to `/home/zetaris/customer-data/shared/bezen/` in the driver container, then run the statements in `data/zetaris_setup.sql`.

```bash
npx tsx agent.ts run             # read, check, remember; writes out/report.md
npx tsx agent.ts why L008        # trace one decision
npx tsx agent.ts approve mem-8   # a human confirms it
npm test                         # critic tests, no network, no key
```

Without Zetaris running, `run` still works on the fallback snapshot and says so.

## Existing components (declared)

Per rule 4.2, work done before the build window:
- **BEZEN pattern layer.** The reply-reading method and its states come from the existing Hebrew BEZEN reply-reader skill (`bezen-replies` plugin). `src/reader.ts` contains a new English port written during the build window.
- **Meterless agentathon-starter.** The project began from `templates/agentathon-starter` (first commit, 22 Oct 2026). `src/engine.ts` is the starter's loader.
- **Zetaris getting-started** helper scripts were used to register the tables.

New in the build window: the Zetaris sources and federated query, the investigator, the critic with retry and escalation, the H-MEM finding schema and supersede chain, `why`/`approve`/`reject`, the report and the tests.

## Data

All eight replies and leads are **synthetic**, written for this demo. No real people, no personal data.

## Cost

One run reads 8 replies on `claude-opus-5-5` at low effort: a few cents. The critic and memory cost nothing.

## License

Apache-2.0 (inherited from the Meterless starter).
