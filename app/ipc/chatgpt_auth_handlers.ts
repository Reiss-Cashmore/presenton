import { ipcMain, shell, BrowserWindow } from "electron";
import http from "http";
import url from "url";

/**
 * ChatGPT OAuth PKCE IPC Handlers
 *
 * Handles the OAuth flow from the Electron main process:
 * 1. Opens the authorization URL in the user's default browser
 * 2. Listens on localhost:1455 for the OAuth callback
 * 3. Returns the authorization code to the renderer
 */

const OAUTH_CALLBACK_PORT = 1455;

let callbackServer: http.Server | null = null;

export function setupChatGPTAuthHandlers() {
  /**
   * Start the OAuth flow:
   * - Open the authorization URL in the default browser
   * - Start a local HTTP server to capture the callback
   * - Return the authorization code
   */
  ipcMain.handle(
    "chatgpt-auth:open-login",
    async (_event, authorizationUrl: string) => {
      return new Promise<{ code: string; state: string }>((resolve, reject) => {
        // Clean up any existing server
        if (callbackServer) {
          callbackServer.close();
          callbackServer = null;
        }

        const timeout = setTimeout(() => {
          if (callbackServer) {
            callbackServer.close();
            callbackServer = null;
          }
          reject(new Error("OAuth login timed out after 5 minutes"));
        }, 5 * 60 * 1000); // 5 minute timeout

        // Create local server to capture the OAuth callback
        callbackServer = http.createServer((req, res) => {
          const parsedUrl = url.parse(req.url || "", true);

          if (parsedUrl.pathname === "/auth/callback") {
            const code = parsedUrl.query.code as string;
            const state = parsedUrl.query.state as string;
            const error = parsedUrl.query.error as string;

            if (error) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(`
                <html>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #e74c3c;">Authentication Failed</h1>
                    <p>Error: ${error}</p>
                    <p>You can close this window.</p>
                  </body>
                </html>
              `);
              clearTimeout(timeout);
              callbackServer?.close();
              callbackServer = null;
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (code) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(`
                <html>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #27ae60;">✓ Authentication Successful</h1>
                    <p>You can close this window and return to Presenton.</p>
                    <script>setTimeout(() => window.close(), 2000);</script>
                  </body>
                </html>
              `);
              clearTimeout(timeout);
              callbackServer?.close();
              callbackServer = null;
              resolve({ code, state });
            } else {
              res.writeHead(400, { "Content-Type": "text/html" });
              res.end(`
                <html>
                  <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1>Missing authorization code</h1>
                    <p>Please try again.</p>
                  </body>
                </html>
              `);
            }
          } else {
            res.writeHead(404);
            res.end("Not found");
          }
        });

        callbackServer.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timeout);
          if (err.code === "EADDRINUSE") {
            reject(
              new Error(
                `Port ${OAUTH_CALLBACK_PORT} is already in use. Please close any other application using this port and try again.`
              )
            );
          } else {
            reject(new Error(`Failed to start callback server: ${err.message}`));
          }
        });

        callbackServer.listen(OAUTH_CALLBACK_PORT, "localhost", () => {
          // Open the authorization URL in the default browser
          shell.openExternal(authorizationUrl);
        });
      });
    }
  );

  /**
   * Manual callback: user pastes the redirect URL or code
   * (for headless/remote environments where the callback server can't bind)
   */
  ipcMain.handle(
    "chatgpt-auth:manual-callback",
    async (_event, redirectUrlOrCode: string) => {
      try {
        let code: string;
        let state: string | undefined;

        // Check if it's a full URL or just a code
        if (
          redirectUrlOrCode.startsWith("http://") ||
          redirectUrlOrCode.startsWith("https://")
        ) {
          const parsedUrl = url.parse(redirectUrlOrCode, true);
          code = parsedUrl.query.code as string;
          state = parsedUrl.query.state as string;
          if (!code) {
            throw new Error("No authorization code found in the URL");
          }
        } else {
          code = redirectUrlOrCode.trim();
        }

        return { code, state };
      } catch (error: any) {
        throw new Error(`Failed to parse callback: ${error.message}`);
      }
    }
  );

  /**
   * Cancel any in-progress OAuth flow
   */
  ipcMain.handle("chatgpt-auth:cancel", async () => {
    if (callbackServer) {
      callbackServer.close();
      callbackServer = null;
    }
    return { success: true };
  });
}
