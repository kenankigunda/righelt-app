---
id: "t-079"
title: "Background job to hard delete soft-deleted games after N days"
status: "To Do"
assignee: []
created_date: "2026-04-04"
updated_date: "2026-04-04"
labels: ["improvement"]
priority: "medium"
dependencies: ["t-030"]
---

## Description

Followup to T-030 (soft delete). Add a scheduled background job (Cloudflare Worker Cron Trigger or equivalent) that hard-deletes games that have been soft-deleted for N or more days, permanently removing them from the `live_games` table (and any associated DO/D1 state).

N should be a configurable constant (e.g. 30 days). The job should be idempotent and safe to re-run.
