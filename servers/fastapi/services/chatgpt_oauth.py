"""
ChatGPT OAuth 2.0 PKCE Authentication Service

Implements the same OAuth flow used by ChatGPT/Codex CLI:
1. Generate PKCE verifier/challenge + random state
2. Open https://auth.openai.com/oauth/authorize
3. Capture callback on http://localhost:1455/auth/callback
4. Exchange code at https://auth.openai.com/oauth/token
5. Extract accountId from the access token
6. Store { access, refresh, expires, accountId }
"""

import base64
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Optional

import aiohttp


# OpenAI OAuth constants (same as Codex CLI)
OPENAI_AUTH_URL = "https://auth.openai.com/oauth/authorize"
OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_OAUTH_SCOPE = "openid profile email offline_access"
OAUTH_CALLBACK_PORT = 1455
OAUTH_REDIRECT_URI = f"http://localhost:{OAUTH_CALLBACK_PORT}/auth/callback"

# ChatGPT API
CHATGPT_BACKEND_API_URL = "https://chatgpt.com/backend-api"
CHATGPT_USAGE_URL = f"{CHATGPT_BACKEND_API_URL}/wham/usage"

# Known Codex models
KNOWN_CHATGPT_MODELS = [
    "gpt-5.1-codex",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
]


@dataclass
class PKCEChallenge:
    """PKCE code verifier and challenge pair."""

    code_verifier: str
    code_challenge: str
    state: str


@dataclass
class ChatGPTCredential:
    """Stored ChatGPT OAuth credential."""

    access_token: str
    refresh_token: str
    expires_at: float  # Unix timestamp
    account_id: Optional[str] = None

    @property
    def is_expired(self) -> bool:
        return time.time() >= self.expires_at

    def to_dict(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "account_id": self.account_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ChatGPTCredential":
        return cls(
            access_token=data["access_token"],
            refresh_token=data["refresh_token"],
            expires_at=data["expires_at"],
            account_id=data.get("account_id"),
        )


def generate_pkce_challenge() -> PKCEChallenge:
    """Generate PKCE code_verifier, code_challenge, and state.

    Algorithm (per the guide):
    1. Generate 32 random bytes
    2. Base64url-encode them → code_verifier
    3. SHA-256 hash the verifier string
    4. Base64url-encode the hash → code_challenge
    """
    # 32 random bytes → base64url (strip padding)
    verifier_bytes = os.urandom(32)
    code_verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode("ascii")

    # SHA-256 of the verifier string → base64url
    challenge_bytes = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode("ascii")

    # Random state: 16 random bytes → hex
    state = secrets.token_hex(16)

    return PKCEChallenge(
        code_verifier=code_verifier,
        code_challenge=code_challenge,
        state=state,
    )


def build_authorization_url(pkce: PKCEChallenge) -> str:
    """Build the OpenAI OAuth authorization URL."""
    import urllib.parse

    params = {
        "response_type": "code",
        "client_id": OPENAI_OAUTH_CLIENT_ID,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "scope": OPENAI_OAUTH_SCOPE,
        "code_challenge": pkce.code_challenge,
        "code_challenge_method": "S256",
        "state": pkce.state,
        "id_token_add_organizations": "true",
        "codex_cli_simplified_flow": "true",
        "originator": "pi",
    }
    return f"{OPENAI_AUTH_URL}?{urllib.parse.urlencode(params)}"


async def exchange_code_for_tokens(
    code: str, code_verifier: str
) -> ChatGPTCredential:
    """Exchange authorization code for access and refresh tokens."""
    payload = {
        "grant_type": "authorization_code",
        "client_id": OPENAI_OAUTH_CLIENT_ID,
        "code": code,
        "code_verifier": code_verifier,
        "redirect_uri": OAUTH_REDIRECT_URI,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            OPENAI_TOKEN_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise Exception(
                    f"Token exchange failed ({resp.status}): {error_text}"
                )

            data = await resp.json()

    access_token = data["access_token"]
    refresh_token = data.get("refresh_token", "")
    expires_in = data.get("expires_in", 3600)
    expires_at = time.time() + expires_in

    # Extract account_id from the JWT access token (decode without verification)
    account_id = _extract_account_id(access_token)

    return ChatGPTCredential(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        account_id=account_id,
    )


async def refresh_access_token(refresh_token: str) -> ChatGPTCredential:
    """Refresh an expired access token using the refresh token."""
    payload = {
        "grant_type": "refresh_token",
        "client_id": OPENAI_OAUTH_CLIENT_ID,
        "refresh_token": refresh_token,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            OPENAI_TOKEN_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        ) as resp:
            if resp.status != 200:
                error_text = await resp.text()
                raise Exception(
                    f"Token refresh failed ({resp.status}): {error_text}"
                )

            data = await resp.json()

    access_token = data["access_token"]
    new_refresh_token = data.get("refresh_token", refresh_token)
    expires_in = data.get("expires_in", 3600)
    expires_at = time.time() + expires_in

    account_id = _extract_account_id(access_token)

    return ChatGPTCredential(
        access_token=access_token,
        refresh_token=new_refresh_token,
        expires_at=expires_at,
        account_id=account_id,
    )


async def fetch_chatgpt_usage(
    access_token: str, account_id: Optional[str] = None
) -> dict:
    """Fetch usage stats from ChatGPT backend API."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    if account_id:
        headers["ChatGPT-Account-Id"] = account_id

    async with aiohttp.ClientSession() as session:
        async with session.get(CHATGPT_USAGE_URL, headers=headers) as resp:
            if resp.status != 200:
                return {"error": f"Usage fetch failed ({resp.status})"}
            return await resp.json()


def _extract_account_id(access_token: str) -> Optional[str]:
    """Extract chatgpt_account_id from a JWT access token without verification.

    The access token is a JWT. Decode its payload (no verification needed)
    and read the chatgpt_account_id from the custom claim
    ``https://api.openai.com/auth``.
    """
    try:
        # JWT has 3 parts separated by dots; payload is the second part
        parts = access_token.split(".")
        if len(parts) < 2:
            return None

        # Add padding for base64 decoding
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes)

        # The account ID lives under the custom claim
        auth_claim = payload.get("https://api.openai.com/auth", {})
        return auth_claim.get("chatgpt_account_id")
    except Exception:
        return None


# In-memory PKCE state (for the OAuth flow in progress)
_active_pkce: Optional[PKCEChallenge] = None


def start_oauth_flow() -> str:
    """Start the OAuth PKCE flow and return the authorization URL."""
    global _active_pkce
    _active_pkce = generate_pkce_challenge()
    return build_authorization_url(_active_pkce)


def get_active_pkce() -> Optional[PKCEChallenge]:
    """Get the currently active PKCE challenge (if any)."""
    return _active_pkce


def clear_active_pkce():
    """Clear the active PKCE challenge after use."""
    global _active_pkce
    _active_pkce = None
