"""
Billing router — Razorpay (India) + Stripe (global)
Country-based pricing:
  India : BYOK ₹25/mo  | Ollama ₹35/mo  → Razorpay (INR)
  Global: BYOK $2/mo   | Ollama $3/mo   → Stripe (USD)
Endpoints:
  GET  /billing/pricing        → detect country, return prices + gateway
  POST /billing/create-order   → create Razorpay (IN) or Stripe (global) order
  POST /billing/verify         → verify payment, unlock tier
  POST /billing/stripe-webhook → Stripe webhook handler
  GET  /billing/status         → user's current tier
  POST /billing/keys           → save encrypted API key
  GET  /billing/keys           → list saved providers
  DELETE /billing/keys/{prov}  → remove a key
"""
import os, hmac, hashlib, httpx
from fastapi import APIRouter, HTTPException, Depends, Request, Header
from pydantic import BaseModel
from core.database import get_db
from core.auth import get_current_user
from core.encryption import encrypt, decrypt
from core.launch import is_free_window, free_window_info
from typing import Optional

router = APIRouter()

# ── Gateway config ────────────────────────────────────────────────────────────
RZP_KEY_ID        = os.getenv("RAZORPAY_KEY_ID", "")
RZP_KEY_SECRET    = os.getenv("RAZORPAY_KEY_SECRET", "")
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUB_KEY    = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# ── Stripe price IDs (create these in Stripe dashboard) ──────────────────────
STRIPE_PRICE_IDS = {
    "byok":   os.getenv("STRIPE_PRICE_BYOK",   ""),   # $2/mo recurring
    "ollama": os.getenv("STRIPE_PRICE_OLLAMA", ""),   # $3/mo recurring
}

# ── Pricing table ─────────────────────────────────────────────────────────────
# India: Razorpay in INR paise  (₹25 = 2500 paise, ₹35 = 3500 paise)
# Global: Stripe in USD cents   ($2  = 200 cents,  $3  = 300 cents)
PRICING = {
    "IN": {
        "currency": "INR",
        "gateway":  "razorpay",
        "symbol":   "₹",
        "byok":   {"amount": 2500,  "display": "₹25"},
        "ollama": {"amount": 3500,  "display": "₹35"},
    },
    "__global__": {
        "currency": "USD",
        "gateway":  "stripe",
        "symbol":   "$",
        "byok":   {"amount": 200,   "display": "$2"},
        "ollama": {"amount": 300,   "display": "$3"},
    },
}

async def _detect_country(request: Request) -> str:
    """Detect country from IP using free ip-api.com (no key needed)."""
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "")
    ip = ip.split(",")[0].strip()
    # Skip for localhost
    if ip in ("127.0.0.1", "::1", ""):
        return "IN"  # default to IN for local dev
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip}?fields=countryCode")
            data = resp.json()
            return data.get("countryCode", "__global__")
    except Exception:
        return "__global__"

def _get_pricing(country: str) -> dict:
    return PRICING.get(country, PRICING["__global__"])

# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_user_tier(user_id: str, db) -> dict:
    # During the launch free window, everyone gets full access
    if is_free_window():
        return {"byok": True, "ollama": True}
    async with db.execute(
        "SELECT byok_enabled, ollama_enabled FROM users WHERE id=?", (user_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        return {"byok": False, "ollama": False}
    return {"byok": bool(row["byok_enabled"]), "ollama": bool(row["ollama_enabled"])}

def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    msg = f"{order_id}|{payment_id}"
    expected = hmac.new(RZP_KEY_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _unlock_plan(plan: str, user_id: str, db):
    if plan == "byok":
        await db.execute("UPDATE users SET byok_enabled=1 WHERE id=?", (user_id,))
    elif plan == "ollama":
        await db.execute("UPDATE users SET byok_enabled=1, ollama_enabled=1 WHERE id=?", (user_id,))
    await db.commit()

# ── Public launch window info (no auth required) ─────────────────────────────

@router.get("/launch")
async def launch_window():
    """Public endpoint — frontend uses this for the free-window countdown banner."""
    return free_window_info()


# ── Pricing ───────────────────────────────────────────────────────────────────

async def get_pricing(request: Request):
    """Detect country from IP and return correct pricing + gateway."""
    country = await _detect_country(request)
    pricing = _get_pricing(country)
    return {
        "country": country,
        "gateway": pricing["gateway"],
        "currency": pricing["currency"],
        "symbol": pricing["symbol"],
        "razorpay_key_id": RZP_KEY_ID if pricing["gateway"] == "razorpay" else None,
        "stripe_pub_key":  STRIPE_PUB_KEY if pricing["gateway"] == "stripe" else None,
        "plans": {
            "byok":   {"amount": pricing["byok"]["amount"],   "display": pricing["byok"]["display"],   "label": f"BYOK Plan — {pricing['byok']['display']}/month"},
            "ollama": {"amount": pricing["ollama"]["amount"], "display": pricing["ollama"]["display"], "label": f"Ollama Plan — {pricing['ollama']['display']}/month"},
        }
    }

class CreateOrderRequest(BaseModel):
    plan: str  # "byok" | "ollama"

@router.post("/create-order")
async def create_order(body: CreateOrderRequest, request: Request, current=Depends(get_current_user)):
    if body.plan not in ("byok", "ollama"):
        raise HTTPException(status_code=400, detail="Invalid plan")

    country = await _detect_country(request)
    pricing = _get_pricing(country)

    # ── India → Razorpay ──────────────────────────────────────────
    if pricing["gateway"] == "razorpay":
        if not RZP_KEY_ID or not RZP_KEY_SECRET:
            raise HTTPException(status_code=503, detail="Razorpay not configured. Contact support.")
        import razorpay
        client = razorpay.Client(auth=(RZP_KEY_ID, RZP_KEY_SECRET))
        plan_pricing = pricing[body.plan]
        order = client.order.create({
            "amount": plan_pricing["amount"],
            "currency": "INR",
            "receipt": f"{current['sub']}_{body.plan}",
            "notes": {"user_id": current["sub"], "plan": body.plan}
        })
        return {
            "gateway":  "razorpay",
            "order_id": order["id"],
            "amount":   plan_pricing["amount"],
            "currency": "INR",
            "key_id":   RZP_KEY_ID,
            "plan":     body.plan,
            "label":    f"BYOK Plan — {plan_pricing['display']}/month" if body.plan == "byok" else f"Ollama Plan — {plan_pricing['display']}/month",
            "display":  plan_pricing["display"],
        }

    # ── Global → Stripe ───────────────────────────────────────────
    else:
        if not STRIPE_SECRET_KEY:
            raise HTTPException(status_code=503, detail="Stripe not configured. Contact support.")
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY
        price_id = STRIPE_PRICE_IDS.get(body.plan)
        if not price_id:
            raise HTTPException(status_code=503, detail=f"Stripe price ID for {body.plan} not configured.")
        plan_pricing = pricing[body.plan]
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/profile?payment=success&plan={body.plan}",
            cancel_url=f"{os.getenv('FRONTEND_URL', 'http://localhost:3000')}/profile?payment=cancelled",
            metadata={"user_id": current["sub"], "plan": body.plan},
        )
        return {
            "gateway":      "stripe",
            "checkout_url": session.url,
            "plan":         body.plan,
            "display":      plan_pricing["display"],
        }

class VerifyRazorpayRequest(BaseModel):
    razorpay_order_id:   str
    razorpay_payment_id: str
    razorpay_signature:  str
    plan: str

@router.post("/verify")
async def verify_razorpay(body: VerifyRazorpayRequest, current=Depends(get_current_user), db=Depends(get_db)):
    """Verify Razorpay payment (India only)."""
    if not _verify_razorpay_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")
    await _unlock_plan(body.plan, current["sub"], db)
    return {"ok": True, "plan": body.plan}

@router.post("/stripe-webhook")
async def stripe_webhook(request: Request):
    """
    Stripe sends payment events here.
    - checkout.session.completed  : first payment; store subscription_id + unlock plan
    - invoice.payment_succeeded   : renewal; look up user by stored subscription_id
    - customer.subscription.deleted: cancellation; lock plan back down
    """
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    payload    = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    import aiosqlite
    from core.database import DB_PATH

    obj = event["data"]["object"]

    # ── First payment: checkout session completed ─────────────────────────────
    if event["type"] == "checkout.session.completed":
        metadata      = obj.get("metadata", {})
        user_id       = metadata.get("user_id")
        plan          = metadata.get("plan")
        subscription_id = obj.get("subscription")
        if user_id and plan:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                await _unlock_plan(plan, user_id, db)
                # Store the subscription_id so renewals can find this user
                if subscription_id:
                    await db.execute(
                        "UPDATE users SET stripe_subscription_id=?, stripe_plan=? WHERE id=?",
                        (subscription_id, plan, user_id)
                    )
                    await db.commit()

    # ── Recurring renewal: invoice paid ──────────────────────────────────────
    elif event["type"] == "invoice.payment_succeeded":
        subscription_id = obj.get("subscription")
        if subscription_id:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT id, stripe_plan FROM users WHERE stripe_subscription_id=?",
                    (subscription_id,)
                ) as cur:
                    user = await cur.fetchone()
            if user and user["stripe_plan"]:
                async with aiosqlite.connect(DB_PATH) as db:
                    await _unlock_plan(user["stripe_plan"], user["id"], db)

    # ── Subscription cancelled ────────────────────────────────────────────────
    elif event["type"] == "customer.subscription.deleted":
        subscription_id = obj.get("id")
        if subscription_id:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT id FROM users WHERE stripe_subscription_id=?",
                    (subscription_id,)
                ) as cur:
                    user = await cur.fetchone()
            if user:
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        "UPDATE users SET byok_enabled=0, ollama_enabled=0, stripe_subscription_id=NULL, stripe_plan=NULL WHERE id=?",
                        (user["id"],)
                    )
                    await db.commit()

    return {"ok": True}

@router.get("/status")
async def billing_status(request: Request, current=Depends(get_current_user), db=Depends(get_db)):
    tier    = await _get_user_tier(current["sub"], db)
    country = await _detect_country(request)
    pricing = _get_pricing(country)
    window  = free_window_info()
    return {
        "user_id":        current["sub"],
        "byok_enabled":   tier["byok"],
        "ollama_enabled": tier["ollama"],
        "country":        country,
        "gateway":        pricing["gateway"],
        "currency":       pricing["currency"],
        "symbol":         pricing["symbol"],
        "razorpay_key_id": RZP_KEY_ID if pricing["gateway"] == "razorpay" and RZP_KEY_ID else None,
        "stripe_pub_key":  STRIPE_PUB_KEY if pricing["gateway"] == "stripe" and STRIPE_PUB_KEY else None,
        "plans": {
            "byok":   {"display": pricing["byok"]["display"],   "amount": pricing["byok"]["amount"]},
            "ollama": {"display": pricing["ollama"]["display"], "amount": pricing["ollama"]["amount"]},
        },
        "launch_window": window,
    }

# ── API Key management ────────────────────────────────────────────────────────

# groq is available to ALL tiers — free users supply their own Groq key for the agent
VALID_PROVIDERS = {"groq", "openai", "anthropic", "google", "ollama_url"}

class SaveKeyRequest(BaseModel):
    provider: str
    key_value: str

@router.post("/keys")
async def save_key(body: SaveKeyRequest, current=Depends(get_current_user), db=Depends(get_db)):
    if body.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider. Must be one of: {VALID_PROVIDERS}")

    # Check tier permission:
    # groq      — any tier (all users need their own key; no server-side key is used)
    # openai/anthropic/google — BYOK plan required (waived during free window)
    # ollama_url — Ollama plan required (waived during free window)
    if not is_free_window():
        tier = await _get_user_tier(current["sub"], db)
        if body.provider == "ollama_url" and not tier["ollama"]:
            raise HTTPException(status_code=403, detail="Ollama plan required")
        if body.provider in {"openai", "anthropic", "google"} and not tier["byok"]:
            raise HTTPException(status_code=403, detail="BYOK plan required")
    # groq: no tier check — all users may save their own Groq key

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

# ── Subscription cancellation ─────────────────────────────────────────────────

@router.post("/cancel")
async def cancel_subscription(current=Depends(get_current_user), db=Depends(get_db)):
    """
    Cancel the user's active Stripe subscription at period end.
    Razorpay subscriptions must be cancelled manually for now
    (Razorpay recurring API requires server-side subscription tracking).
    The plan remains active until the current billing period ends.
    """
    async with db.execute(
        "SELECT stripe_subscription_id, stripe_plan FROM users WHERE id=?", (current["sub"],)
    ) as cur:
        row = await cur.fetchone()

    if not row or not row["stripe_subscription_id"]:
        raise HTTPException(status_code=400, detail="No active Stripe subscription found")

    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    try:
        # cancel_at_period_end=True keeps access until the period ends
        stripe.Subscription.modify(
            row["stripe_subscription_id"],
            cancel_at_period_end=True
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=f"Stripe error: {e.user_message}")

    return {"ok": True, "message": "Subscription will cancel at end of billing period. You keep access until then."}
