# BEZEN Reply Reader for Jira Service Management (Forge)

A Rovo agent that reads a customer's reply on a request before anyone answers it, and says:
what the customer is protecting, the exact words that show it, what must not be done now,
whether a bot or a human should answer, and the next message.

Built for Codegeist 2026 (category: Apps for Business Teams). It is a rebuild on Forge of
[the original BEZEN Reply Reader](../README.md), which read sales replies from a CRM.

## How it works

| Part | What it is | Why it is not a model |
|---|---|---|
| Reader | `rovo:agent` with the BEZEN layer as its prompt (`resource/agent/prompt.txt`) | It is the model |
| `get-customer-reply` | Action. Fetches the reporter's newest comment from Jira, plus earlier readings of this request | The agent never supplies the text it is checked against |
| `check-reading` | Action. Runs the critic (`src/critic.js`) against the reply it fetched itself, and logs the decision on the issue | A quote that is not in the reply is rejected. `intrusion` and `guilt_or_loss` are never auto-answered |
| Retry, then a human | First rejection: one more try. Second: escalated, no message | The count is read from the ledger, so asking again does not reset it |
| Ledger | Issue property `bezen-reply-ledger` | Every reading, pass or fail, stays on the request |
| Panel | `jira:issuePanel` (UI Kit) showing the readings | A human confirms or rejects each reading; the agent never posts to the customer |

## Run it

```bash
npm install
npm test            # critic tests, no Jira and no network
forge register      # once, creates the app id in manifest.yml
forge deploy
forge install       # pick your Jira site with Jira Service Management and Rovo
```

Then open a request, open Rovo chat, pick **BEZEN Reply Reader** and ask it to read the latest reply.
The **BEZEN Reply Reader** panel on the request shows the reading and the critic's decision.
