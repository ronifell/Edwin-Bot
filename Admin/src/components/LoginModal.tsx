"use client";

import { FormEvent, useState } from "react";

type Props = {
  apiBaseUrl: string;
  onSuccess: (token: string) => void;
  onClose?: () => void;
};

export function LoginModal({ apiBaseUrl, onSuccess, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const trimmed = password.trim();
      const response = await fetch(`${apiBaseUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: trimmed }),
      });
      let data: { ok?: boolean; error?: string; token?: string } = {};
      try {
        data = await response.json();
      } catch {
        throw new Error(response.status ? `Login failed (HTTP ${response.status})` : "Login failed");
      }
      if (!response.ok || !data?.ok || !data?.token) {
        const code = data?.error || "Login failed";
        const friendly =
          code === "invalid_password"
            ? "Invalid password (must match ADMIN_PASSWORD on the server exactly)."
            : code === "login_disabled_set_ADMIN_PASSWORD"
              ? "Server has no ADMIN_PASSWORD set."
              : code === "login_requires_ADMIN_API_TOKEN"
                ? "Server has no ADMIN_API_TOKEN set."
                : code;
        throw new Error(friendly);
      }
      onSuccess(data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={() => onClose?.()}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950 p-8 shadow-2xl"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-sky-400">Secure access</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Admin sign in</h2>
        <p className="mt-2 text-sm text-slate-400">
          Enter the password configured on the server (<code className="text-sky-300">ADMIN_PASSWORD</code>).
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="h-12 w-full rounded-xl border border-white/10 bg-slate-900/80 px-4 text-sm text-white outline-none focus:border-sky-500"
          />
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onClose?.()}
              className="h-12 flex-1 rounded-xl border border-white/10 text-sm text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="h-12 flex-[2] rounded-xl bg-sky-500 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
            >
              {loading ? "Signing in..." : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
