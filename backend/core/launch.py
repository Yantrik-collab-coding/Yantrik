"""
core/launch.py — Global launch window helper

During the free window (now < FREE_UNTIL_DATE), all users are treated as if
they have both BYOK and Ollama unlocked — no payment required.

Set in .env:
  LAUNCH_DATE=2026-03-20       # when Yantrik went live (informational)
  FREE_UNTIL=2026-06-20        # last day of free access (inclusive)

After FREE_UNTIL, normal billing gates apply.
"""

import os
from datetime import date, datetime


def _parse_date(env_var: str, fallback: date) -> date:
    raw = os.getenv(env_var, "").strip()
    if not raw:
        return fallback
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        print(f"⚠️  Invalid date format for {env_var}='{raw}'. Expected YYYY-MM-DD. Using fallback {fallback}.")
        return fallback


# Default: free window ends 3 months after today's date if not set
_DEFAULT_FREE_UNTIL = date(2026, 9, 20)

LAUNCH_DATE: date = _parse_date("LAUNCH_DATE", date(2026, 3, 20))
FREE_UNTIL: date  = _parse_date("FREE_UNTIL",  _DEFAULT_FREE_UNTIL)


def is_free_window() -> bool:
    """Returns True if we are currently inside the launch free window."""
    return date.today() <= FREE_UNTIL


def free_window_info() -> dict:
    """Returns info about the launch window — used in /billing/status."""
    today = date.today()
    in_window = today <= FREE_UNTIL
    days_left = (FREE_UNTIL - today).days if in_window else 0
    return {
        "launch_date":     LAUNCH_DATE.isoformat(),
        "free_until":      FREE_UNTIL.isoformat(),
        "in_free_window":  in_window,
        "days_remaining":  max(days_left, 0),
    }
