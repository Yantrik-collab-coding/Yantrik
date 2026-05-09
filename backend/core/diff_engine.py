"""
diff_engine.py — Unified diff generation + risk scoring
Adapted from AI-CTO project for Yantrik's SQLite/aiosqlite stack.
Pure utility — never modifies files, never raises (always returns safe defaults).
"""
import difflib
import re

HIGH_RISK_THRESHOLD = 100
MED_RISK_THRESHOLD  = 20

_PUBLIC_INTERFACE_RE = re.compile(r"^[+-]\s*(def |class |async def )", re.MULTILINE)
_IMPORT_CHANGE_RE    = re.compile(r"^[+-]\s*(import |from .+ import )",  re.MULTILINE)


def generate_unified_diff(filename: str, before: str, after: str) -> str:
    before_lines = before.splitlines(keepends=True)
    after_lines  = after.splitlines(keepends=True)
    diff_lines   = list(difflib.unified_diff(
        before_lines, after_lines,
        fromfile=f"a/{filename}", tofile=f"b/{filename}",
        lineterm=""
    ))
    return "\n".join(diff_lines)


def score_risk(diff_text: str) -> str:
    if not diff_text:
        return "low"
    added   = [l for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++")]
    removed = [l for l in diff_text.splitlines() if l.startswith("-") and not l.startswith("---")]
    net     = len(added) + len(removed)

    if _PUBLIC_INTERFACE_RE.search(diff_text): return "high"
    if _IMPORT_CHANGE_RE.search(diff_text):    return "high"
    if net > HIGH_RISK_THRESHOLD:              return "high"
    if removed and len(removed) > len(added) * 2 and len(removed) > 10: return "high"
    if net > MED_RISK_THRESHOLD:               return "medium"
    if any(re.match(r"^[+-]\s{4,}", l) for l in diff_text.splitlines()): return "medium"
    return "low"


def count_changes(diff_text: str) -> tuple[int, int]:
    """Returns (lines_added, lines_removed)."""
    added   = sum(1 for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff_text.splitlines() if l.startswith("-") and not l.startswith("---"))
    return added, removed
