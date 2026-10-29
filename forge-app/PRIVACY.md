# BEZEN Reply Reader: Privacy Policy

Last updated: 29 October 2026

BEZEN Reply Reader is a Forge app for Jira Service Management. It runs entirely on Atlassian's platform.

## What the app reads
When a user asks the agent to read a request, the app reads that request's summary, description, reporter and comments through the Jira API.

## What the app stores
For each reading, the app stores on the same Jira request (as an issue property named `bezen-reply-ledger`): the reading itself, a short quote from the customer's reply, the reply author's display name, the checker's decision, and whether a team member confirmed or rejected it. At most the last 50 entries are kept per request.

This data stays inside your own Jira site. The app does not send data to any server outside Atlassian, uses no external services, and does not sell or share data with anyone.

## Removing data
Deleting the request, or uninstalling the app and deleting the `bezen-reply-ledger` issue property, removes the stored readings.

## Contact
cozion@gmail.com
