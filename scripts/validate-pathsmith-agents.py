#!/usr/bin/env python3
"""Offline structural checks for the supplied Pathsmith Codex configuration.

Requires Python 3.11+. Uses no third-party packages and never calls a model or
network. This is NOT the Codex loader, a complete upstream schema validator, or
a check of account model/effort availability. Does not modify checked files.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11+ is required for the standard-library TOML parser.")
import tomllib

ROLES = {
    "pathsmith_explorer", "pathsmith_implementer", "pathsmith_architect",
    "pathsmith_reviewer", "pathsmith_verifier",
}
SKILLS = {
    "pathsmith-runtime", "pathsmith-ui", "pathsmith-provider",
    "pathsmith-verification",
}
READ_ONLY = {"pathsmith_explorer", "pathsmith_reviewer"}
EFFORTS = {"low", "medium", "high", "xhigh", "max", "ultra"}
ROLE_KEYS = {
    "name", "description", "developer_instructions", "model",
    "model_reasoning_effort", "sandbox_mode",
}
BEGIN = "<!-- BEGIN PATHSMITH CODEX ROUTING v1 -->"
END = "<!-- END PATHSMITH CODEX ROUTING v1 -->"


def check(root: Path) -> list[str]:
    errors: list[str] = []

    def require(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    def read_text(relative: str) -> str:
        try:
            return (root / relative).read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as exc:
            errors.append(f"{relative}: {exc}")
            return ""

    def read_toml(relative: str) -> dict:
        text = read_text(relative)
        try:
            return tomllib.loads(text)
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"{relative}: invalid TOML: {exc}")
            return {}

    def check_model(data: dict, label: str) -> None:
        model = data.get("model")
        require(isinstance(model, str) and bool(model.strip()), f"{label}: missing model")
        require(isinstance(data.get("model_reasoning_effort"), str)
                and data["model_reasoning_effort"] in EFFORTS,
                f"{label}: missing/unrecognized reasoning effort for this checker")

    config = read_toml(".codex/config.toml")
    check_model(config, "project config")
    agents = config.get("agents", {})
    require(isinstance(agents, dict), "[agents] must be a table")
    if isinstance(agents, dict):
        require(agents.get("enabled") is True, "agents.enabled must be true for this pack")
        cap = agents.get("max_concurrent_threads_per_session")
        require(type(cap) is int and cap > 0, "agent concurrency cap must be a positive integer")

    for role in sorted(ROLES):
        relative = f".codex/agents/{role}.toml"
        data = read_toml(relative)
        require(data.get("name") == role, f"{relative}: agent name must match filename")
        for key in ("description", "developer_instructions"):
            require(isinstance(data.get(key), str) and bool(data[key].strip()),
                    f"{relative}: missing {key}")
        check_model(data, role)
        require(set(data).issubset(ROLE_KEYS),
                f"{relative}: fields outside the pack's documented subset: {set(data) - ROLE_KEYS}")
        if role in READ_ONLY:
            require(data.get("sandbox_mode") == "read-only", f"{role}: expected read-only default")
        else:
            require("sandbox_mode" not in data, f"{role}: writer must inherit sandbox permissions")

    # Deliberately supports only the simple metadata style shipped in this pack;
    # this is not a general YAML parser.
    for skill in sorted(SKILLS):
        relative = f".agents/skills/{skill}/SKILL.md"
        text = read_text(relative)
        lines = text.splitlines()
        require(bool(lines) and lines[0] == "---", f"{relative}: missing frontmatter")
        try:
            closing = lines.index("---", 1)
        except ValueError:
            errors.append(f"{relative}: unterminated frontmatter")
            continue
        header = "\n".join(lines[1:closing])
        require(re.search(rf"^name:\s*{re.escape(skill)}\s*$", header, re.M) is not None,
                f"{relative}: name must match directory")
        match = re.search(r"^description:\s*(.+)$", header, re.M)
        description = ""
        if match:
            raw = match.group(1)
            try:
                description = json.loads(raw) if raw.startswith('"') else raw
            except json.JSONDecodeError as exc:
                errors.append(f"{relative}: malformed quoted description: {exc}")
        require(isinstance(description, str) and bool(description.strip()),
                f"{relative}: description is empty")
        require(bool("\n".join(lines[closing + 1:]).strip()), f"{relative}: empty skill body")

    instructions = read_text("AGENTS.md")
    fragment = read_text("docs/codex/AGENTS_ROUTING.md").strip()
    require(instructions.count(BEGIN) == 1, "AGENTS.md must contain one routing block start")
    require(instructions.count(END) == 1, "AGENTS.md must contain one routing block end")
    require(bool(fragment) and fragment in instructions, "routing fragment must be included unchanged")
    require(len(instructions.encode("utf-8")) <= 32768,
            "root AGENTS.md exceeds 32 KiB; also review aggregate inherited guidance")
    for name in sorted(ROLES | SKILLS):
        require(name in fragment, f"routing instructions missing {name}")
    for doc in ("PATHSMITH_AGENTS_README.md", "docs/codex/INSTALL_WITH_CODEX.md",
                "docs/codex/SMOKE_TESTS.md", "docs/codex/SOURCES.md"):
        require((root / doc).is_file(), f"missing documentation: {doc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="Pathsmith repository or extracted pack root")
    args = parser.parse_args()
    root = args.root.resolve()
    errors = check(root)
    if errors:
        print(f"FAIL: {len(errors)} configuration issue(s)")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("PASS: 6 TOML files parsed; 5 role definitions and 4 skill metadata blocks checked.")
    print("PASS: routing references, merge markers, root instruction size, and document paths checked.")
    print("Not checked: Codex loading, full upstream schema, account access, effective permissions, or routing quality.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
