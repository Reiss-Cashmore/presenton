# Login with ChatGPT — Step-by-Step Implementation Guide

This guide walks you through implementing **"Login with ChatGPT"** (OpenAI Codex OAuth) from scratch, covering how to obtain the necessary credentials, understand the OAuth flow, and integrate it into your application.

---

## Overview

ChatGPT/OpenAI Codex uses **OAuth 2.0 Authorization Code + PKCE** (Proof Key for Code Exchange). This is a **public client** flow — there is **no client secret**. Authentication security relies entirely on PKCE.

| Parameter            | Value                                              |
| -------------------- | -------------------------------------------------- |
| **Client ID**        | `app_EMoamEEZ73f0CkXaXp7hrann`                    |
| **Client Secret**    | None (public client — PKCE only)                   |
| **Authorization URL**| `https://auth.openai.com/oauth/authorize`          |
| **Token URL**        | `https://auth.openai.com/oauth/token`              |
| **Redirect URI**     | `http://localhost:1455/auth/callback`               |
| **Scopes**           | `openid profile email offline_access`              |
| **PKCE Method**      | `S256`                                             |
| **API Base URL**     | `https://chatgpt.com/backend-api`                  |

---

## Step 1: Understand the Credentials

### Client ID

The client ID is a **public, fixed value** used by the Codex CLI ecosystem:

```
app_EMoamEEZ73f0CkXaXp7hrann
```

This is the same client ID used by OpenAI's own Codex CLI. You do **not** need to register your own OAuth app with OpenAI — you reuse this public client ID.

### Client Secret

There is **no client secret**. This is a public OAuth client that relies on PKCE for security. The `code_verifier` + `code_challenge` pair replaces the need for a secret.

### Redirect URI

The OAuth callback URL is:

```
http://localhost:1455/auth/callback
```

Your application must start a local HTTP server on port `1455` to capture the callback. If running in a headless/remote environment, you can fall back to having the user paste the redirect URL manually.

---

## Step 2: Generate PKCE Parameters

PKCE prevents authorization code interception attacks. You need to generate a **verifier** and a **challenge** before each login attempt.

### Algorithm

1. Generate 32 random bytes
2. Base64url-encode them → this is the `code_verifier`
3. SHA-256 hash the verifier string
4. Base64url-encode the hash → this is the `code_challenge`

### Implementation (Node.js / TypeScript)

```typescript
import crypto from "node:crypto";

function base64urlEncode(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);

  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));

  return { verifier, challenge };
}
```

### Implementation (Python)

```python
import os
import hashlib
import base64

def generate_pkce():
    verifier_bytes = os.urandom(32)
    verifier = base64.urlsafe_b64encode(verifier_bytes).rstrip(b"=").decode("ascii")

    challenge_bytes = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(challenge_bytes).rstrip(b"=").decode("ascii")

    return verifier, challenge
```

---

## Step 3: Generate a Random State Parameter

The `state` parameter prevents CSRF attacks. Generate a random hex string:

```typescript
import crypto from "node:crypto";

const state = crypto.randomBytes(16).toString("hex");
// e.g. "a3f1b2c4d5e6f7081920abcdef123456"
```

```python
import secrets
state = secrets.token_hex(16)
```

Store this value — you'll verify it when the callback arrives.

---

## Step 4: Build the Authorization URL

Construct the URL that opens in the user's browser:

```
https://auth.openai.com/oauth/authorize
  ?response_type=code
  &client_id=app_EMoamEEZ73f0CkXaXp7hrann
  &redirect_uri=http://localhost:1455/auth/callback
  &scope=openid profile email offline_access
  &code_challenge=<YOUR_CHALLENGE>
  &code_challenge_method=S256
  &state=<YOUR_STATE>
  &id_token_add_organizations=true
  &codex_cli_simplified_flow=true
  &originator=pi
```

### Full Example (TypeScript)

```typescript
function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL("https://auth.openai.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", "app_EMoamEEZ73f0CkXaXp7hrann");
  url.searchParams.set("redirect_uri", "http://localhost:1455/auth/callback");
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "pi");
  return url.toString();
}
```

### Query Parameters Explained

| Parameter                      | Value / Purpose                                              |
| ------------------------------ | ------------------------------------------------------------ |
| `response_type`                | `code` — standard authorization code flow                    |
| `client_id`                    | `app_EMoamEEZ73f0CkXaXp7hrann` — public Codex client        |
| `redirect_uri`                 | `http://localhost:1455/auth/callback`                        |
| `scope`                        | `openid profile email offline_access` — includes refresh     |
| `code_challenge`               | Base64url SHA-256 of your PKCE verifier                      |
| `code_challenge_method`        | `S256`                                                       |
| `state`                        | Random hex string for CSRF protection                        |
| `id_token_add_organizations`   | `true` — includes org info in the ID token                   |
| `codex_cli_simplified_flow`    | `true` — uses the simplified Codex login UI                  |
| `originator`                   | `pi` — identifies the requesting application                 |

---

## Step 5: Start a Local Callback Server

Start an HTTP server on `127.0.0.1:1455` to capture the OAuth callback:

```typescript
import { createServer } from "node:http";
import { URL } from "node:url";

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:1455`);

      if (url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      // Respond to the browser
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Authentication complete</h1><p>You can close this tab.</p></body></html>");

      server.close();

      if (error) {
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== expectedState) {
        reject(new Error("State mismatch — possible CSRF attack"));
        return;
      }

      if (!code) {
        reject(new Error("No authorization code received"));
        return;
      }

      resolve(code);
    });

    server.listen(1455, "127.0.0.1");

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("Login timed out"));
    }, 5 * 60 * 1000);
  });
}
```

### Headless / Remote Fallback

If port 1455 can't bind (e.g., Docker, SSH, VPS), instruct the user to:

1. Open the authorization URL in their **local** browser
2. After signing in, copy the **full redirect URL** from the browser address bar
3. Paste it back into your application
4. Parse the `code` and `state` query parameters from the pasted URL

---

## Step 6: Exchange the Authorization Code for Tokens

Once you have the `code` from the callback, exchange it for access + refresh tokens:

```typescript
async function exchangeCodeForTokens(
  code: string,
  verifier: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    code: code,
    code_verifier: verifier,
    redirect_uri: "http://localhost:1455/auth/callback",
  });

  const res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: HTTP ${res.status} — ${text}`);
  }

  return await res.json();
}
```

### Response Shape

```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "v1|abc123...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "id_token": "eyJhbGciOi..."
}
```

---

## Step 7: Extract the Account ID from the Access Token

The access token is a JWT. Decode its payload (no verification needed for extraction) and read the `chatgpt_account_id`:

```typescript
function extractAccountId(accessToken: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64").toString("utf8")
    );
    // The account ID lives under the custom claim
    const authClaim = payload["https://api.openai.com/auth"];
    return authClaim?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}
```

The `accountId` is needed as a header (`ChatGPT-Account-Id`) when making API calls.

---

## Step 8: Store the Credentials

Store the full credential set for future use:

```typescript
type ChatGPTCredentials = {
  access_token: string;
  refresh_token: string;
  expires_at: number;      // Unix timestamp in ms
  account_id?: string;
};

function storeCredentials(tokens: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): ChatGPTCredentials {
  const accountId = extractAccountId(tokens.access_token);

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    account_id: accountId,
  };
}
```

---

## Step 9: Refresh Expired Tokens

When `expires_at` is in the past, refresh the token:

```typescript
async function refreshAccessToken(
  refreshToken: string
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: HTTP ${res.status}`);
  }

  return await res.json();
}
```

> **Important:** OpenAI may issue a **new refresh token** on each refresh. Always store the latest refresh token from the response. Using an old/revoked refresh token will fail.

---

## Step 10: Make API Calls

Use the access token to call the ChatGPT backend API:

```typescript
async function callChatGPTApi(
  credentials: ChatGPTCredentials,
  endpoint: string,
  body: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.access_token}`,
    "Content-Type": "application/json",
  };

  if (credentials.account_id) {
    headers["ChatGPT-Account-Id"] = credentials.account_id;
  }

  return fetch(`https://chatgpt.com/backend-api${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
```

### Key Endpoints

| Endpoint                     | Purpose                                    |
| ---------------------------- | ------------------------------------------ |
| `/codex/responses`           | Send prompts to Codex models               |
| `/wham/usage`                | Fetch usage / rate-limit status             |

### Available Models

| Model ID          | Description                     |
| ----------------- | ------------------------------- |
| `gpt-5.1-codex`  | GPT-5.1 Codex                   |
| `gpt-5.2-codex`  | GPT-5.2 Codex (supports xhigh thinking) |
| `gpt-5.3-codex`  | GPT-5.3 Codex (latest, supports xhigh thinking) |

---

## Complete Flow Diagram

```
┌──────────────┐
│ Your App     │
└──────┬───────┘
       │ 1. Generate PKCE (verifier + challenge) + state
       │ 2. Build authorize URL
       │ 3. Start local server on :1455
       │ 4. Open browser → auth.openai.com/oauth/authorize
       ▼
┌──────────────┐
│ User Browser │ ──→ Signs in with ChatGPT account
└──────┬───────┘
       │ 5. Redirect to localhost:1455/auth/callback?code=XXX&state=YYY
       ▼
┌──────────────┐
│ Local Server │ ──→ Captures code, verifies state
└──────┬───────┘
       │ 6. POST auth.openai.com/oauth/token
       │    (grant_type=authorization_code, code, code_verifier)
       ▼
┌──────────────┐
│ Token Resp   │ ──→ { access_token, refresh_token, expires_in }
└──────┬───────┘
       │ 7. Decode JWT → extract chatgpt_account_id
       │ 8. Store credentials
       ▼
┌──────────────┐
│ API Calls    │ ──→ chatgpt.com/backend-api/codex/responses
│              │     Authorization: Bearer <access_token>
│              │     ChatGPT-Account-Id: <account_id>
└──────────────┘
```

---

## Checklist

- [ ] Generate PKCE verifier (32 random bytes → base64url) and challenge (SHA-256 → base64url)
- [ ] Generate random state (16 random bytes → hex)
- [ ] Build authorization URL with all required parameters
- [ ] Start local HTTP server on `127.0.0.1:1455`
- [ ] Open browser to the authorization URL
- [ ] Capture the callback and extract `code` + verify `state`
- [ ] Exchange the code for tokens at `auth.openai.com/oauth/token`
- [ ] Decode the access token JWT to extract `chatgpt_account_id`
- [ ] Store `access_token`, `refresh_token`, `expires_at`, and `account_id`
- [ ] Implement token refresh before expiry using `grant_type=refresh_token`
- [ ] Include `Authorization: Bearer` and `ChatGPT-Account-Id` headers on API calls

---

## Troubleshooting

| Issue                             | Cause / Fix                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Port 1455 already in use          | Kill the process using the port, or fall back to manual URL paste              |
| `invalid_grant` on token exchange | Code expired (they're single-use and short-lived) — restart the flow           |
| `invalid_grant` on refresh        | Refresh token was revoked (another client refreshed first) — re-login          |
| State mismatch                    | Possible CSRF or stale login attempt — restart the flow                        |
| 401/403 on API calls              | Token expired — refresh it; or account doesn't have Codex access               |
| No `chatgpt_account_id` in JWT    | Account may not have a ChatGPT subscription — check plan eligibility           |

---

## Security Notes

- **Never hardcode or log refresh tokens** in production
- **Store credentials securely** (encrypted file, OS keychain, etc.)
- **Always verify the `state` parameter** on callback to prevent CSRF
- **Refresh tokens are rotated** — always persist the newest one
- The `client_id` is public and safe to embed in client-side code (PKCE protects the flow)
- Running the callback server on `127.0.0.1` (not `0.0.0.0`) prevents external access
