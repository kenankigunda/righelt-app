Refer to `AGENTS.md` in this parent workspace first.

If you are working on product code or interpreting team shorthands, also open:

- `__APP_REPO__/AGENTS.md`

That file contains the full repo operating rules, including team shorthands, testing policy, branch conventions, backlog workflow, and ticket workflow instructions.

Default git-aware execution root: `__APP_REPO__`
Prefer direct repo wrapper commands such as `./scripts/git-app.sh`, `./scripts/backlog-sync.sh`, `./scripts/backlog.sh`, and `./scripts/backlog-doc.sh`; use shell wrappers only as a last resort.

## Validation and shepherding

For end-to-end evidence, integrated PR validation, and autonomous repairs, read `__APP_REPO__/skills/validate-and-shepherd/SKILL.md`. The skill includes recipient preflight, hosted review reports, and explicit email merge authorization.
