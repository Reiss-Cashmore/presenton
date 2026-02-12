"use client";
import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2, LogIn, LogOut, Shield, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Switch } from "./ui/switch";
import { getApiUrl } from "@/utils/api";

interface ChatGPTConfigProps {
  chatgptAccessToken: string;
  chatgptRefreshToken: string;
  chatgptAccountId: string;
  chatgptModel: string;
  chatgptTokenExpiresAt: number | undefined;
  webGrounding?: boolean;
  onInputChange: (value: string | boolean | number, field: string) => void;
}

export default function ChatGPTConfig({
  chatgptAccessToken,
  chatgptRefreshToken,
  chatgptAccountId,
  chatgptModel,
  chatgptTokenExpiresAt,
  webGrounding,
  onInputChange,
}: ChatGPTConfigProps) {
  const [openModelSelect, setOpenModelSelect] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [pollingForAuth, setPollingForAuth] = useState(false);
  const [localAuthState, setLocalAuthState] = useState<{
    accessToken: string;
    tokenExpiresAt?: number;
  } | null>(null);

  // Use local auth state if available, otherwise fall back to props
  const effectiveAccessToken = localAuthState?.accessToken || chatgptAccessToken;
  const effectiveTokenExpiresAt = localAuthState?.tokenExpiresAt || chatgptTokenExpiresAt;
  const isAuthenticated = Boolean(effectiveAccessToken);
  const isTokenExpired = effectiveTokenExpiresAt
    ? Date.now() / 1000 >= effectiveTokenExpiresAt
    : false;

  // Check for existing authentication on mount
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        const response = await fetch('/api/user-config');
        if (response.ok) {
          const config = await response.json();
          if (config.CHATGPT_ACCESS_TOKEN && !effectiveAccessToken) {
            // Update local auth state if we find tokens but props haven't updated yet
            setLocalAuthState({
              accessToken: config.CHATGPT_ACCESS_TOKEN,
              tokenExpiresAt: config.CHATGPT_TOKEN_EXPIRES_AT
            });
          }
        }
      } catch (error) {
        console.error('Error checking existing auth:', error);
      }
    };

    checkExistingAuth();
  }, []); // Run once on mount

  // Fetch available models when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchAvailableModels();
    }
  }, [isAuthenticated]);

  // Poll for authentication status when showing manual entry
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (showManualEntry && pollingForAuth) {
      interval = setInterval(async () => {
        try {
          // Check if user config has been updated with ChatGPT tokens
          const response = await fetch('/api/user-config');
          if (response.ok) {
            const config = await response.json();
            if (config.CHATGPT_ACCESS_TOKEN) {
              // Update local auth state immediately for instant UI update
              setLocalAuthState({
                accessToken: config.CHATGPT_ACCESS_TOKEN,
                tokenExpiresAt: config.CHATGPT_TOKEN_EXPIRES_AT
              });
              
              // Authentication successful! Update the parent component
              onInputChange(config.CHATGPT_ACCESS_TOKEN, "chatgpt_access_token");
              onInputChange(config.CHATGPT_REFRESH_TOKEN, "chatgpt_refresh_token");
              onInputChange(config.CHATGPT_TOKEN_EXPIRES_AT, "chatgpt_token_expires_at");
              if (config.CHATGPT_ACCOUNT_ID) {
                onInputChange(config.CHATGPT_ACCOUNT_ID, "chatgpt_account_id");
              }
              
              // Hide manual entry and stop polling
              setShowManualEntry(false);
              setPollingForAuth(false);
              setLoginLoading(false);
              toast.success("Successfully logged in with ChatGPT!");
              return;
            }
          }
        } catch (error) {
          console.error('Error checking auth status:', error);
        }
      }, 2000); // Check every 2 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showManualEntry, pollingForAuth, onInputChange]);

  const fetchAvailableModels = async () => {
    setModelsLoading(true);
    try {
      const response = await fetch(
        getApiUrl("api/v1/ppt/chatgpt-auth/models")
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data);
        // Auto-select default model if none selected
        if (!chatgptModel && data.length > 0) {
          onInputChange(data[0], "chatgpt_model");
        }
      }
    } catch (error) {
      console.error("Error fetching ChatGPT models:", error);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      // Step 1: Get authorization URL from backend
      const loginResponse = await fetch(
        getApiUrl("api/v1/ppt/chatgpt-auth/login"),
        { method: "POST" }
      );
      if (!loginResponse.ok) {
        throw new Error("Failed to start login flow");
      }
      const { authorization_url } = await loginResponse.json();

      // Step 2: Open browser and wait for callback (Electron) or manual entry (web)
      let code: string;
      let state: string | undefined;

      if (
        typeof window !== "undefined" &&
        (window as any).electron?.chatgptOpenLogin
      ) {
        // Electron: open browser and capture callback automatically
        try {
          const result = await (window as any).electron.chatgptOpenLogin(
            authorization_url
          );
          code = result.code;
          state = result.state;
        } catch (err: any) {
          // If auto-capture fails, show manual entry
          setShowManualEntry(true);
          window.open(authorization_url, "_blank");
          setLoginLoading(false);
          return;
        }
      } else {
        // Web: open in new tab and show manual code entry
        window.open(authorization_url, "_blank");
        setShowManualEntry(true);
        setPollingForAuth(true);
        setLoginLoading(false);
        return;
      }

      // Step 3: Exchange code for tokens
      await exchangeCode(code, state);
    } catch (error: any) {
      toast.error(error.message || "Login failed");
      setLoginLoading(false);
    }
  };

  const handleManualCodeSubmit = async () => {
    if (!manualCode.trim()) return;
    setLoginLoading(true);

    try {
      let code: string;
      let state: string | undefined;

      // Check if it's a full URL or just a code
      if (manualCode.startsWith("http")) {
        const url = new URL(manualCode);
        code = url.searchParams.get("code") || "";
        state = url.searchParams.get("state") || undefined;
      } else {
        code = manualCode.trim();
      }

      if (!code) {
        throw new Error("No authorization code found");
      }

      await exchangeCode(code, state);
      setShowManualEntry(false);
      setManualCode("");
    } catch (error: any) {
      toast.error(error.message || "Failed to exchange code");
    } finally {
      setLoginLoading(false);
    }
  };

  const exchangeCode = async (code: string, state?: string) => {
    const callbackResponse = await fetch(
      getApiUrl("api/v1/ppt/chatgpt-auth/callback"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      }
    );

    if (!callbackResponse.ok) {
      const error = await callbackResponse.json();
      throw new Error(error.detail || "Token exchange failed");
    }

    const tokenData = await callbackResponse.json();

    // Update config with token data
    onInputChange(tokenData.access_token, "chatgpt_access_token");
    onInputChange(tokenData.refresh_token, "chatgpt_refresh_token");
    onInputChange(tokenData.expires_at, "chatgpt_token_expires_at");
    if (tokenData.account_id) {
      onInputChange(tokenData.account_id, "chatgpt_account_id");
    }

    toast.success("Successfully logged in with ChatGPT!");
    setLoginLoading(false);
  };

  const handleRefreshToken = async () => {
    if (!chatgptRefreshToken) {
      toast.error("No refresh token available. Please login again.");
      return;
    }

    setLoginLoading(true);
    try {
      const response = await fetch(
        getApiUrl("api/v1/ppt/chatgpt-auth/refresh"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: chatgptRefreshToken }),
        }
      );

      if (!response.ok) {
        throw new Error("Token refresh failed. Please login again.");
      }

      const tokenData = await response.json();
      onInputChange(tokenData.access_token, "chatgpt_access_token");
      onInputChange(tokenData.refresh_token, "chatgpt_refresh_token");
      onInputChange(tokenData.expires_at, "chatgpt_token_expires_at");
      if (tokenData.account_id) {
        onInputChange(tokenData.account_id, "chatgpt_account_id");
      }

      toast.success("Token refreshed successfully!");
    } catch (error: any) {
      toast.error(error.message || "Token refresh failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Clear local auth state immediately for instant UI feedback
      setLocalAuthState(null);
      
      // Update parent component state
      onInputChange("", "chatgpt_access_token");
      onInputChange("", "chatgpt_refresh_token");
      onInputChange("", "chatgpt_account_id");
      onInputChange(0, "chatgpt_token_expires_at");
      onInputChange("", "chatgpt_model");
      setAvailableModels([]);
      
      // Persist logout to userConfig file by calling the API
      const response = await fetch('/api/user-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CHATGPT_ACCESS_TOKEN: '',
          CHATGPT_REFRESH_TOKEN: '',
          CHATGPT_ACCOUNT_ID: '',
          CHATGPT_TOKEN_EXPIRES_AT: 0,
          CHATGPT_MODEL: ''
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save logout state');
      }
      
      toast.success("Successfully logged out from ChatGPT");
    } catch (error) {
      console.error('Error during logout:', error);
      toast.error("Logout completed but failed to save. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Auth Status Banner */}
      <div
        className={cn(
          "p-4 rounded-lg border",
          isAuthenticated && !isTokenExpired
            ? "bg-green-50 border-green-200"
            : isAuthenticated && isTokenExpired
            ? "bg-yellow-50 border-yellow-200"
            : "bg-gray-50 border-gray-200"
        )}
      >
        <div className="flex items-center gap-3">
          <Shield
            className={cn(
              "w-5 h-5",
              isAuthenticated && !isTokenExpired
                ? "text-green-600"
                : isAuthenticated && isTokenExpired
                ? "text-yellow-600"
                : "text-gray-400"
            )}
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">
              {isAuthenticated && !isTokenExpired
                ? "Authenticated with ChatGPT"
                : isAuthenticated && isTokenExpired
                ? "Token expired — refresh needed"
                : "Not authenticated"}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {isAuthenticated
                ? `Account: ${chatgptAccountId || "Unknown"}`
                : "Login with your ChatGPT account to use ChatGPT models"}
            </p>
          </div>
          {isAuthenticated && (
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          )}
        </div>
      </div>

      {/* Login / Refresh Button */}
      {!isAuthenticated ? (
        <div className="space-y-3">
          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className={cn(
              "w-full py-3 px-4 rounded-lg transition-all duration-200 border-2 flex items-center justify-center gap-2",
              loginLoading
                ? "bg-gray-100 border-gray-300 cursor-not-allowed text-gray-500"
                : "bg-white border-emerald-600 text-emerald-600 hover:bg-emerald-50 focus:ring-2 focus:ring-emerald-500/20"
            )}
          >
            {loginLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Waiting for authentication...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Login with ChatGPT (OAuth)
              </>
            )}
          </button>

          <p className="text-sm text-gray-500 flex items-center gap-2">
            <span className="block w-1 h-1 rounded-full bg-gray-400"></span>
            Uses OpenAI OAuth 2.0 PKCE — the same auth as ChatGPT & Codex CLI
          </p>

          {/* Manual code entry (fallback for headless/web) */}
          {showManualEntry && (
            <div className="space-y-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              {pollingForAuth && (
                <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-100 px-3 py-2 rounded-md">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking for completed authentication...</span>
                </div>
              )}
              
              <p className="text-sm text-blue-800 flex items-center gap-1">
                <ExternalLink className="w-3.5 h-3.5" />
                {pollingForAuth ? "We're automatically checking if you completed the login. You can also manually paste the redirect URL or code below:" : "After authorizing in the browser, paste the redirect URL or code below:"}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="Paste redirect URL or authorization code"
                />
                <button
                  onClick={handleManualCodeSubmit}
                  disabled={!manualCode.trim() || loginLoading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Submit
                </button>
              </div>
              
              {pollingForAuth && (
                <button
                  onClick={() => {
                    setPollingForAuth(false);
                    setShowManualEntry(false);
                    setLoginLoading(false);
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Cancel automatic checking
                </button>
              )}
            </div>
          )}
        </div>
      ) : isTokenExpired ? (
        <button
          onClick={handleRefreshToken}
          disabled={loginLoading}
          className={cn(
            "w-full py-2.5 px-4 rounded-lg transition-all duration-200 border-2 flex items-center justify-center gap-2",
            loginLoading
              ? "bg-gray-100 border-gray-300 cursor-not-allowed text-gray-500"
              : "bg-white border-yellow-600 text-yellow-600 hover:bg-yellow-50"
          )}
        >
          {loginLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Refreshing token...
            </>
          ) : (
            "Refresh Token"
          )}
        </button>
      ) : null}

      {/* Model Selection - only show when authenticated */}
      {isAuthenticated && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Select ChatGPT Model
          </label>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading models...
            </div>
          ) : (
            <div className="w-full">
              <Popover
                open={openModelSelect}
                onOpenChange={setOpenModelSelect}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openModelSelect}
                    className="w-full h-12 px-4 py-4 outline-none border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors hover:border-gray-400 justify-between"
                  >
                    <div className="flex gap-3 items-center">
                      <span className="text-sm font-medium text-gray-900">
                        {chatgptModel
                          ? availableModels.find(
                              (model) => model === chatgptModel
                            ) || chatgptModel
                          : "Select a model"}
                      </span>
                    </div>
                    <ChevronsUpDown className="w-4 h-4 text-gray-500" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0"
                  align="start"
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                >
                  <Command>
                    <CommandInput placeholder="Search models..." />
                    <CommandList>
                      <CommandEmpty>No model found.</CommandEmpty>
                      <CommandGroup>
                        {availableModels.map((model, index) => (
                          <CommandItem
                            key={index}
                            value={model}
                            onSelect={(value) => {
                              onInputChange(value, "chatgpt_model");
                              setOpenModelSelect(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                chatgptModel === model
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            <span className="text-sm font-medium text-gray-900">
                              {model}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      )}

      {/* Web Grounding Toggle */}
      {isAuthenticated && (
        <div>
          <div className="flex items-center justify-between mb-4 bg-green-50 p-2 rounded-sm">
            <label className="text-sm font-medium text-gray-700">
              Enable Web Grounding
            </label>
            <Switch
              checked={!!webGrounding}
              onCheckedChange={(checked) =>
                onInputChange(checked, "web_grounding")
              }
            />
          </div>
          <p className="mt-2 text-sm text-gray-500 flex items-center gap-2">
            <span className="block w-1 h-1 rounded-full bg-gray-400"></span>
            If enabled, the model can use web search grounding when available.
          </p>
        </div>
      )}

      {/* Info box */}
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>ChatGPT OAuth</strong> uses your existing ChatGPT subscription.
          No API key required — authentication happens through OpenAI&apos;s secure
          OAuth 2.0 PKCE flow, the same method used by the Codex CLI.
        </p>
      </div>
    </div>
  );
}
