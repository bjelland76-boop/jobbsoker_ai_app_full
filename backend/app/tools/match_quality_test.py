"""Match quality validator: full vs compressed inputs.

Usage (from repo root):

```bash
python3 -m backend.app.tools.match_quality_test --job job.txt --cv cv.txt
```

This runs the matcher twice against the same job posting:
- FULL: minimal/no compression (larger max_len, no relevance filter)
- COMPRESSED: default production settings (relevance filter + truncation)

Success criteria:
- score difference should be small
- warn if difference > 10 points
"""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.app.ai_matcher import analyze_job_match, _compress_text, _extract_relevant


def _read_text(path: str) -> str:
    p = Path(path)
    return p.read_text(encoding="utf-8", errors="ignore")


def _fmt_list(items: list[str] | None) -> str:
    items = items or []
    if not items:
        return "(none)"
    return "\n".join([f"- {x}" for x in items])


def main() -> int:
    ap = argparse.ArgumentParser(description="Compare matcher output for FULL vs COMPRESSED inputs")
    ap.add_argument("--job", required=True, help="Path to job description text file")
    ap.add_argument("--cv", required=True, help="Path to CV text file")
    ap.add_argument("--full-max-len", type=int, default=9000, help="Max chars for FULL run")
    ap.add_argument("--compressed-max-len", type=int, default=2500, help="Max chars for COMPRESSED run")
    args = ap.parse_args()

    job_text = _read_text(args.job)
    cv_text = _read_text(args.cv)

    # FULL run: keep much more context and disable relevance extraction.
    full = analyze_job_match(
        job_text,
        cv_text,
        max_len=int(args.full_max_len),
        extract_relevant=False,
        use_cache=False,
    )

    # COMPRESSED run: use production defaults.
    comp = analyze_job_match(
        job_text,
        cv_text,
        max_len=int(args.compressed_max_len),
        extract_relevant=True,
        use_cache=False,
    )

    full_score = int(full.get("score", 0))
    comp_score = int(comp.get("score", 0))
    diff = comp_score - full_score

    # Show what we actually sent in the compressed path (for debugging).
    job_comp_preview = _compress_text(_extract_relevant(job_text), int(args.compressed_max_len))
    cv_comp_preview = _compress_text(_extract_relevant(cv_text), int(args.compressed_max_len))

    print("=" * 72)
    print("MATCH QUALITY TEST")
    print("=" * 72)
    print(f"Job chars: {len(job_text)} | CV chars: {len(cv_text)}")
    print(f"Compressed job chars: {len(job_comp_preview)} | Compressed CV chars: {len(cv_comp_preview)}")
    print("-")

    print("FULL RESULT")
    print(f"score: {full_score}")
    print(f"interview_probability: {full.get('interview_probability', 0)}")
    print(f"seniority_match: {full.get('seniority_match', 0)}")
    print(f"top_reason: {full.get('top_reason', '')}")
    print(f"main_risk: {full.get('main_risk', '')}")
    print("strengths:\n" + _fmt_list(full.get("strengths") or []))
    print("missing:\n" + _fmt_list(full.get("missing") or []))
    print("-")

    print("COMPRESSED RESULT")
    print(f"score: {comp_score}")
    print(f"interview_probability: {comp.get('interview_probability', 0)}")
    print(f"seniority_match: {comp.get('seniority_match', 0)}")
    print(f"top_reason: {comp.get('top_reason', '')}")
    print(f"main_risk: {comp.get('main_risk', '')}")
    print("strengths:\n" + _fmt_list(comp.get("strengths") or []))
    print("missing:\n" + _fmt_list(comp.get("missing") or []))
    print("-")

    print("COMPARISON")
    print(f"score diff (compressed - full): {diff}")

    full_strengths = set(full.get("strengths") or [])
    comp_strengths = set(comp.get("strengths") or [])
    full_missing = set(full.get("missing") or [])
    comp_missing = set(comp.get("missing") or [])

    if full_strengths != comp_strengths:
        print("strengths delta:")
        only_full = sorted(full_strengths - comp_strengths)
        only_comp = sorted(comp_strengths - full_strengths)
        if only_full:
            print("  only FULL:\n" + "\n".join([f"    - {x}" for x in only_full]))
        if only_comp:
            print("  only COMPRESSED:\n" + "\n".join([f"    - {x}" for x in only_comp]))

    if full_missing != comp_missing:
        print("missing delta:")
        only_full = sorted(full_missing - comp_missing)
        only_comp = sorted(comp_missing - full_missing)
        if only_full:
            print("  only FULL:\n" + "\n".join([f"    - {x}" for x in only_full]))
        if only_comp:
            print("  only COMPRESSED:\n" + "\n".join([f"    - {x}" for x in only_comp]))

    if abs(diff) > 10:
        print("WARNING: score difference exceeds 10 points. Compression may hurt match quality.")

    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
