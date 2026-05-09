"""
Billing router — PAYMENTS DISABLED for testing/friends distribution phase.

Only API key management endpoints are active.
Payment routes (create-order, verify, stripe-webhook, cancel) are commented out.
Status endpoint returns "all unlocked" so the frontend works without payment walls.

To re-enable payments: restore the full billing.py from version control.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.database import get_db
from core.auth import get_current_user
from core.encryption import encrypt

router = APIRouter()


# ── Status — returns everything unlocked during testing phase ─────────────────

@router.get("/status")
async def billing_status(current=Depends(get_current_user)):
    """During testing phase, report all tiers as active."""
    return {
        "user_id":        current["sub"],
        "byok_enabled":   True,
        "ollama_enabled": True,
        "country":        "TESTING",
        "gateway":        "none",
        "currency":       "FREE",
        "symbol":         "",
        "razorpay_key_id": None,
        "stripe_pub_key":  None,
        "plans": {
            "byok":   {"display": "Free", "amount": 0},
            "ollama": {"display": "Free", "amount": 0},
        },
        "launch_window": {"active": True, "message": "Testing phase — all features unlocked"},
    }


# ── API Key management (kept active — users still need to save their keys) ────

VALID_PROVIDERS = {"groq", "openai", "anthropic", "google", "ollama_url"}

class SaveKeyRequest(BaseModel):
    provider: str
    key_value: str

@router.post("/keys")
async def save_key(body: SaveKeyRequest, current=Depends(get_current_user), db=Depends(get_db)):
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider. Must be one of: {VALID_PROVIDERS}")

    # Testing phase — no tier checks, all providers allowed for everyone
    encrypted = encrypt(body.key_value.strip())
    await db.execute(
        """INSERT INTO user_api_keys (user_id, provider, key_value, updated_at)
           VALUES (?,?,?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, provider) DO UPDATE SET key_value=excluded.key_value, updated_at=CURRENT_TIMESTAMP""",
        (current["sub"], body.provider, encrypted)
    )
    await db.commit()
    return {"ok": True, "provider": body.provider}

@router.get("/keys")
async def list_keys(current=Depends(get_current_user), db=Depends(get_db)):
    """Returns which providers have keys — never the key values themselves."""
    async with db.execute(
        "SELECT provider, updated_at FROM user_api_keys WHERE user_id=?", (current["sub"],)
    ) as cur:
        rows = await cur.fetchall()
    return {"keys": [{"provider": r["provider"], "updated_at": r["updated_at"]} for r in rows]}

@router.delete("/keys/{provider}")
async def delete_key(provider: str, current=Depends(get_current_user), db=Depends(get_db)):
    await db.execute(
        "DELETE FROM user_api_keys WHERE user_id=? AND provider=?", (current["sub"], provider)
    )
    await db.commit()
    return {"ok": True}


# ┌──────────────────────────────────────────────────────────────────────────────┐
# │  PAYMENT ROUTES DISABLED — Uncomment to restore Razorpay/Stripe billing.   │
# │  See git history for the full billing.py with payment code.                 │
# └──────────────────────────────────────────────────────────────────────────────┘
#
# The following routes are disabled:
#   POST /create-order   — create Razorpay/Stripe order
#   POST /verify         — verify Razorpay payment
#   POST /stripe-webhook — Stripe webhook handler
#   POST /cancel         — cancel Stripe subscription
#   GET  /launch         — launch window info
#   GET  /pricing        — detect country + return prices
