#!/usr/bin/env python3
"""List the areas touched by a pull request, for path-gated CI steps.

Stdlib only. Called by `.github/workflows/ci.yml` on self-hosted runners where
the checkout is shallow (`fetch-depth: 1`), so `git diff` against the base is
not available: the changed files are read from the GitHub REST API instead.

Outputs (appended to `$GITHUB_OUTPUT`): `portal`, `infra`, `demo`, `docs`
with value `yes` or `no`. On `workflow_dispatch` (no PR) every area is `yes`.
"""

import json
import os
import re
import sys
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")

AREAS = {
    "portal": re.compile(r"^portal/"),
    "infra": re.compile(r"^infra/"),
    "demo": re.compile(r"^(tools/demo/|demo/|src/)"),
    "docs": re.compile(r"^(docs/|README\.md|CONTRACTS\.md)"),
}


def pr_number() -> str | None:
    """PR number from the event payload, or from a merge-queue ref name."""
    raw = os.environ.get("EVENT_PAYLOAD")
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
        number = (payload.get("pull_request") or {}).get("number")
        if number:
            return str(number)
    ref = os.environ.get("GITHUB_REF", "")
    match = re.search(r"/pr-(\d+)-", ref)
    if match:
        return match.group(1)
    direct = os.environ.get("PR_NUMBER")
    return direct or None


def fetch_files(repo: str, number: str, token: str) -> list[str]:
    files: list[str] = []
    for page in range(1, 4):
        url = f"{API}/repos/{repo}/pulls/{number}/files?per_page=100&page={page}"
        request = urllib.request.Request(url)
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("Accept", "application/vnd.github+json")
        with urllib.request.urlopen(request, timeout=30) as response:
            batch = json.loads(response.read().decode("utf-8"))
        if not batch:
            break
        files.extend(item.get("filename", "") for item in batch)
        if len(batch) < 100:
            break
    return files


def emit(flags: dict[str, str]) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{key}={value}" for key, value in sorted(flags.items())]
    print(" ".join(lines))
    if not output:
        return
    with open(output, "a", encoding="utf-8") as handle:
        for line in lines:
            handle.write(line + "\n")


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    number = pr_number()
    if not number:
        emit({area: "yes" for area in AREAS})
        return 0
    if not repo or not token:
        print("::warning::no repository or token - running every area", file=sys.stderr)
        emit({area: "yes" for area in AREAS})
        return 0

    files = fetch_files(repo, number, token)
    flags = {
        area: "yes" if any(pattern.match(name) for name in files) else "no"
        for area, pattern in AREAS.items()
    }
    print(f"{len(files)} changed file(s) on PR #{number}")
    emit(flags)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
