import { useEffect, useRef, useState } from "react";

function WifiAddress({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function copyAddress() {
    setCopied(false);
    setCopyFailed(false);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        // Local-network HTTP pages do not have the secure clipboard API.
        input.current?.focus();
        input.current?.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      }
      setCopied(true);
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopyFailed(true);
    }
  }

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div>
      <div className="wifi-address">
        <input
          aria-label="Wi-Fi URL"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          ref={input}
          value={url}
        />
        <button onClick={copyAddress}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <span className="wifi-copy-status" role="status">
        {copyFailed
          ? "Address selected. Copy it from the text field."
          : copied ? "Address copied." : ""}
      </span>
    </div>
  );
}

export function WifiAccess() {
  const [failed, setFailed] = useState(false);
  const [urls, setUrls] = useState<string[] | null>(null);

  useEffect(() => {
    let controller: AbortController | undefined;
    async function refresh() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch("/api/network", {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) throw new Error("Network details unavailable");
        const info = (await response.json()) as { urls: string[] };
        if (request.signal.aborted) return;
        setUrls(info.urls);
        setFailed(false);
      } catch {
        if (request.signal.aborted) return;
        setUrls(null);
        setFailed(true);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <section className="wifi-access" aria-label="Wi-Fi access">
      <div className="wifi-description">
        <h2>Open on another device</h2>
        <p>Use the same Wi-Fi as the computer running Harbor.</p>
      </div>
      <div className="wifi-addresses">
        {urls?.length ? (
          urls.map((url) => <WifiAddress key={url} url={url} />)
        ) : (
          <p className="wifi-note">
            {failed
              ? "Wi-Fi address unavailable."
              : urls
                ? "Wi-Fi access is off or no local address is available."
                : "Finding the Wi-Fi address…"}
          </p>
        )}
      </div>
    </section>
  );
}
