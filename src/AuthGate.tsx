import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

type Session = {
  configured: boolean;
  canSetup: boolean;
  authenticated: boolean;
  username?: string;
};
const AuthContext = createContext<{
  username: string;
  logout(): Promise<void>;
  logoutError: string;
} | null>(null);
export const useBrowserAuth = () => useContext(AuthContext);

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    if (mutating.current) return;
    controller.current?.abort();
    const request = new AbortController(),
      generation = epoch.current;
    controller.current = request;
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        signal: request.signal,
      });
      if (!response.ok) throw new Error("Could not check Harbor login.");
      const next = (await response.json()) as Session;
      if (!request.signal.aborted && generation === epoch.current) {
        setSession(next);
        setError("");
      }
    } catch {
      if (!request.signal.aborted && generation === epoch.current)
        setError(
          "Harbor is unavailable. Check that it is running, then retry.",
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const check = () => {
      void refresh();
    };
    const lock = () => {
      epoch.current++;
      controller.current?.abort();
      setSession((current) =>
        current
          ? { ...current, authenticated: false, username: undefined }
          : current,
      );
      void refresh();
    };
    const timer = window.setInterval(check, 30_000);
    window.addEventListener("focus", check);
    window.addEventListener("harbor:auth-check", check);
    window.addEventListener("harbor:auth-required", lock);
    return () => {
      controller.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("harbor:auth-check", check);
      window.removeEventListener("harbor:auth-required", lock);
    };
  }, [refresh]);
  function authenticated(username: string) {
    epoch.current++;
    controller.current?.abort();
    setLogoutError("");
    setSession((current) => ({
      configured: true,
      canSetup: current?.canSetup ?? false,
      authenticated: true,
      username,
    }));
  }
  async function logout() {
    epoch.current++;
    controller.current?.abort();
    mutating.current = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      setSession((current) =>
        current
          ? { ...current, authenticated: false, username: undefined }
          : current,
      );
      setLogoutError("");
    } catch {
      setLogoutError("Could not sign out. Retry when Harbor is connected.");
    } finally {
      mutating.current = false;
    }
  }
  if (session?.authenticated)
    return (
      <AuthContext.Provider
        value={{ username: session.username ?? "", logout, logoutError }}
      >
        {children}
      </AuthContext.Provider>
    );
  return (
    <div className="login-shell">
      <main className="login-card">
        <p className="eyebrow">AGENT HARBOR / LOCAL</p>
        {!session ? (
          <>
            <h1>Welcome to Harbor</h1>
            <p role="status">{error || "Checking your session…"}</p>
            {error && <button onClick={() => void refresh()}>Retry</button>}
          </>
        ) : !session.configured && !session.canSetup ? (
          <>
            <h1>Set up on your computer</h1>
            <p>
              Open <strong>http://127.0.0.1:5173</strong> on the computer
              running Harbor to create your login. Then return here to sign in.
            </p>
            <button onClick={() => void refresh()}>Check again</button>
          </>
        ) : (
          <LoginForm
            setup={!session.configured}
            onAuthenticated={authenticated}
          />
        )}
        {session && error && <p role="status">{error}</p>}
        {location.protocol === "http:" && (
          <p className="login-note">
            This connection uses HTTP. Use Harbor only on trusted Wi-Fi;
            passwords and session traffic are not encrypted in transit.
          </p>
        )}
      </main>
    </div>
  );
}

function LoginForm({
  setup,
  onAuthenticated,
}: {
  setup: boolean;
  onAuthenticated(username: string): void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (setup && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/auth/${setup ? "setup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await response.json()) as {
        username?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      setPassword("");
      setConfirmation("");
      onAuthenticated(data.username!);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{setup ? "Create your Harbor login" : "Log in to Harbor"}</h1>
      <p>
        {setup
          ? "One login protects the history stored on this computer, including Wi-Fi access."
          : "Use the login created on your Harbor computer."}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
            maxLength={80}
            pattern="[A-Za-z0-9._-]+"
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            maxLength={1024}
          />
        </label>
        {setup && (
          <>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                minLength={12}
                maxLength={1024}
              />
            </label>
            <p className="login-note">
              Use at least 12 characters. Username: letters, numbers, dot, dash,
              or underscore.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="telemetry-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Please wait…" : setup ? "Create login" : "Log in"}
        </button>
      </form>
      {!setup && (
        <p className="login-note">
          Forgot your login? On the Harbor computer, run{" "}
          <code>npm run auth:reset</code> in this project, then create a new
          login here. Your history is preserved.
        </p>
      )}
    </>
  );
}
