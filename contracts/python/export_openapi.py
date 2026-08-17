#!/usr/bin/env python3
"""Write this service's OpenAPI spec to a file, or check the committed one is current.

Lives in the FastAPI repo. Two jobs:

    python export_openapi.py                 # regenerate openapi.json
    python export_openapi.py --check         # exit 1 if it drifted (this is the CI step)

`--check` is the guard: it fails the build when someone changes a Pydantic model
without committing the resulting spec change. That makes every wire-format change
visible in a diff, in the pull request that caused it — which is the only place
anyone is going to notice it.

Keys are sorted before writing, because FastAPI's key order is not stable across
versions and an unsorted file turns every regeneration into a diff nobody reads.
The app repo's `tools/pull-openapi.mjs` normalises identically, so the two files
compare byte for byte.

Wire it up:

    # .github/workflows/ci.yml
    - run: python export_openapi.py --check

    # .pre-commit-config.yaml
    - id: openapi
      name: openapi.json is current
      entry: python export_openapi.py
      language: system
      pass_filenames: false
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Point this at your FastAPI instance.
from main import app  # type: ignore[import-not-found]

TARGET = Path(__file__).parent / "openapi.json"


def normalise(value: object) -> object:
    """Sort every mapping key, recursively, so regeneration is diff-stable."""
    if isinstance(value, dict):
        return {key: normalise(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [normalise(item) for item in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail instead of writing")
    parser.add_argument("--out", type=Path, default=TARGET)
    args = parser.parse_args()

    spec = json.dumps(normalise(app.openapi()), indent=2, ensure_ascii=False) + "\n"
    current = args.out.read_text(encoding="utf-8") if args.out.exists() else None

    if current == spec:
        print(f"{args.out.name} is current")
        return 0

    if args.check:
        print(
            f"{args.out.name} is out of date — a model changed and the spec was not committed.\n"
            f"Run:  python {Path(__file__).name}\n"
            f"Then read the diff: it is the change your API clients are about to see.",
            file=sys.stderr,
        )
        return 1

    args.out.write_text(spec, encoding="utf-8")
    print(f"{'Wrote' if current is None else 'Updated'} {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
