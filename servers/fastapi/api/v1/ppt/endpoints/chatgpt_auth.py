"""
ChatGPT OAuth Authentication Endpoints

Provides REST endpoints for the ChatGPT OAuth PKCE flow:
- POST /chatgpt-auth/login     → Start OAuth flow, return authorization URL
- POST /chatgpt-auth/callback  → Exchange authorization code for tokens
- POST /chatgpt-auth/refresh   → Refresh an expired access token
- GET  /chatgpt-auth/usage     → Fetch ChatGPT usage stats
- GET  /chatgpt-auth/models    → List known ChatGPT models
"""

import json
import os
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from services.chatgpt_oauth import (
    KNOWN_CHATGPT_MODELS,
    ChatGPTCredential,
    clear_active_pkce,
    exchange_code_for_tokens,
    fetch_chatgpt_usage,
    get_active_pkce,
    refresh_access_token,
    start_oauth_flow,
)
from utils.get_env import get_user_config_path_env

CHATGPT_AUTH_ROUTER = APIRouter(prefix="/chatgpt-auth", tags=["ChatGPT Auth"])


class LoginResponse(BaseModel):
    authorization_url: str


class CallbackRequest(BaseModel):
    code: str
    state: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: float
    account_id: Optional[str] = None
    authenticated: bool = True


class RefreshRequest(BaseModel):
    refresh_token: str


class UsageResponse(BaseModel):
    usage: dict


@CHATGPT_AUTH_ROUTER.post("/login", response_model=LoginResponse)
async def chatgpt_login():
    """Start the ChatGPT OAuth PKCE flow. Returns the authorization URL to open in a browser."""
    try:
        authorization_url = start_oauth_flow()
        return LoginResponse(authorization_url=authorization_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start OAuth flow: {e}")


@CHATGPT_AUTH_ROUTER.post("/callback", response_model=TokenResponse)
async def chatgpt_callback(request: CallbackRequest):
    """Exchange the authorization code for access/refresh tokens."""
    pkce = get_active_pkce()
    if not pkce:
        raise HTTPException(
            status_code=400,
            detail="No active OAuth flow. Please call /login first.",
        )

    # Verify state if provided
    if request.state and request.state != pkce.state:
        clear_active_pkce()
        raise HTTPException(
            status_code=400,
            detail="State mismatch. Possible CSRF attack.",
        )

    try:
        credential = await exchange_code_for_tokens(
            code=request.code,
            code_verifier=pkce.code_verifier,
        )
        clear_active_pkce()

        # Persist credential to the user config file
        _save_chatgpt_credential(credential)

        return TokenResponse(
            access_token=credential.access_token,
            refresh_token=credential.refresh_token,
            expires_at=credential.expires_at,
            account_id=credential.account_id,
        )
    except Exception as e:
        clear_active_pkce()
        raise HTTPException(
            status_code=500, detail=f"Token exchange failed: {e}"
        )


@CHATGPT_AUTH_ROUTER.post("/refresh", response_model=TokenResponse)
async def chatgpt_refresh(request: RefreshRequest):
    """Refresh an expired access token."""
    try:
        credential = await refresh_access_token(request.refresh_token)

        # Update persisted credential
        _save_chatgpt_credential(credential)

        return TokenResponse(
            access_token=credential.access_token,
            refresh_token=credential.refresh_token,
            expires_at=credential.expires_at,
            account_id=credential.account_id,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Token refresh failed: {e}"
        )


@CHATGPT_AUTH_ROUTER.get("/usage", response_model=UsageResponse)
async def chatgpt_usage(
    access_token: str = Query(...),
    account_id: Optional[str] = Query(None),
):
    """Fetch ChatGPT usage statistics."""
    try:
        usage = await fetch_chatgpt_usage(access_token, account_id)
        return UsageResponse(usage=usage)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Usage fetch failed: {e}"
        )


@CHATGPT_AUTH_ROUTER.get("/models", response_model=list[str])
async def chatgpt_models():
    """Return the list of known ChatGPT models available via OAuth."""
    return KNOWN_CHATGPT_MODELS


@CHATGPT_AUTH_ROUTER.get("/callback-redirect", response_class=HTMLResponse)
async def chatgpt_callback_redirect(request: Request, code: str = Query(...), state: Optional[str] = Query(None), error: Optional[str] = Query(None)):
    """Handle OAuth callback redirect from browser (Docker/web mode)."""
    if error:
        return HTMLResponse(f"""
        <html>
            <head><title>ChatGPT Authentication Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Authentication Failed</h1>
                <p>Error: {error}</p>
                <p>You can close this window and try again.</p>
            </body>
        </html>
        """, status_code=400)

    # Try to complete the OAuth flow automatically
    try:
        pkce = get_active_pkce()
        if not pkce:
            raise HTTPException(status_code=400, detail="No active OAuth flow")
        
        if state and state != pkce.state:
            raise HTTPException(status_code=400, detail="State mismatch")

        credential = await exchange_code_for_tokens(code=code, code_verifier=pkce.code_verifier)
        clear_active_pkce()
        _save_chatgpt_credential(credential)
        
        return HTMLResponse("""
        <html>
            <head><title>ChatGPT Authentication Successful</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #27ae60;">✓ Authentication Successful</h1>
                <p>ChatGPT login completed successfully! You can close this window and return to Presenton.</p>
                <script>
                    setTimeout(() => { 
                        window.close(); 
                        // Try to redirect back to the main app
                        try { window.opener.location.reload(); } catch(e) {}
                    }, 2000);
                </script>
            </body>
        </html>
        """)
    except Exception as e:
        return HTMLResponse(f"""
        <html>
            <head><title>ChatGPT Authentication Error</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #e74c3c;">Authentication Error</h1>
                <p>Failed to complete login: {str(e)}</p>
                <p>Please try again or contact support.</p>
            </body>
        </html>
        """, status_code=500)


def _save_chatgpt_credential(credential: ChatGPTCredential):
    """Save ChatGPT credential into the user config JSON file."""
    user_config_path = get_user_config_path_env()
    if not user_config_path:
        return

    existing_config = {}
    try:
        if os.path.exists(user_config_path):
            with open(user_config_path, "r") as f:
                existing_config = json.load(f)
    except Exception:
        pass

    existing_config["CHATGPT_ACCESS_TOKEN"] = credential.access_token
    existing_config["CHATGPT_REFRESH_TOKEN"] = credential.refresh_token
    existing_config["CHATGPT_TOKEN_EXPIRES_AT"] = credential.expires_at
    existing_config["CHATGPT_ACCOUNT_ID"] = credential.account_id

    try:
        with open(user_config_path, "w") as f:
            json.dump(existing_config, f)
    except Exception as e:
        print(f"Failed to save ChatGPT credential: {e}")
