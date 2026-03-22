"""
AES-256 encryption for storing user API keys.
Uses Fernet (AES-128-CBC + HMAC-SHA256) from cryptography lib.
Key is derived from ENCRYPTION_SECRET in .env.
The Fernet instance is cached as a module-level singleton to avoid
re-deriving the key on every encrypt/decrypt call.
"""
import os, base64, hashlib
from cryptography.fernet import Fernet

_fernet_instance: Fernet | None = None

def _get_fernet() -> Fernet:
    global _fernet_instance
    if _fernet_instance is None:
        secret = os.getenv("ENCRYPTION_SECRET", "yantrik-default-change-in-prod-please")
        key = hashlib.sha256(secret.encode()).digest()
        fernet_key = base64.urlsafe_b64encode(key)
        _fernet_instance = Fernet(fernet_key)
    return _fernet_instance

def encrypt(plain: str) -> str:
    return _get_fernet().encrypt(plain.encode()).decode()

def decrypt(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()
