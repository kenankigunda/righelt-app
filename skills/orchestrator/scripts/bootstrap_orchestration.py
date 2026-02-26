#!/usr/bin/env python3
import argparse
from pathlib import Path


def parse_streams(raw: str) -> list[str]:
    streams = [part.strip() for part in raw.split(",") if part.strip()]
    deduped = []
    seen = set()
    for stream in streams:
        if stream in seen:
            continue
        seen.add(stream)
        deduped.append(stream)
    return deduped


def write_if_missing(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return
    path.write_text(content, encoding="utf-8")


def plan_yaml(feature_id: str, integration_branch: str, max_parallel: int, streams: list[str]) -> str:
    shared_checks = "  - pnpm test"
    stream_chunks = []
    for stream in streams:
        chunk = f"""  - id: {stream}
    goal: "TODO: define goal for {stream}"
    worktree: "../righelt-{feature_id}-{stream}"
    branch: "codex/{feature_id}-{stream}"
    depends_on: []
    acceptance_checks:
      - "TODO: add acceptance command"
    agent_profile: "general"
"""
        stream_chunks.append(chunk)
    streams_block = "".join(stream_chunks).rstrip()
    return f"""feature_id: {feature_id}
integration_branch: {integration_branch}
max_parallel_streams: {max_parallel}
shared_acceptance:
{shared_checks}
streams:
{streams_block}
"""


def stream_brief(feature_id: str, stream_id: str) -> str:
    return f"""# Stream {stream_id}

## Scope
- TODO

## Non-Goals
- TODO

## Deliverables
- TODO

## Required Validation
- TODO: commands and expected outcomes

## Acceptance Checklist
- [ ] Code changes complete
- [ ] Stream acceptance checks passing
- [ ] Dependencies verified
- [ ] Ready for coordinator merge gate

## Notes
- Feature: {feature_id}
"""


def coordination_log(feature_id: str, streams: list[str]) -> str:
    statuses = "\n".join(f"| {s} | pending | - | - | - |" for s in streams)
    return f"""# Coordination Log: {feature_id}

| Stream | Status | Commit | Gate | Notes |
| --- | --- | --- | --- | --- |
{statuses}
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Scaffold feature orchestration files for the orchestrator skill.")
    parser.add_argument("--feature-id", required=True, help="Feature identifier, e.g. F-027")
    parser.add_argument("--streams", required=True, help="Comma-separated stream ids, e.g. api,engine,ui")
    parser.add_argument("--integration-branch", default="main")
    parser.add_argument("--max-parallel", type=int, default=3)
    parser.add_argument("--root", default=".", help="Repository root path")
    args = parser.parse_args()

    streams = parse_streams(args.streams)
    if not streams:
        raise SystemExit("At least one stream is required.")
    if args.max_parallel < 1:
        raise SystemExit("--max-parallel must be >= 1")

    root = Path(args.root).resolve()
    feature_root = root / "docs" / "features" / args.feature_id
    plan_path = feature_root / "plan.yaml"
    log_path = feature_root / "coordination-log.md"
    streams_dir = feature_root / "streams"

    write_if_missing(plan_path, plan_yaml(args.feature_id, args.integration_branch, args.max_parallel, streams))
    write_if_missing(log_path, coordination_log(args.feature_id, streams))
    for stream in streams:
        write_if_missing(streams_dir / f"{stream}.md", stream_brief(args.feature_id, stream))

    print(f"Scaffolded feature orchestration under: {feature_root}")
    print(f"Plan: {plan_path}")
    print(f"Log: {log_path}")
    print(f"Streams: {', '.join(streams)}")


if __name__ == "__main__":
    main()
