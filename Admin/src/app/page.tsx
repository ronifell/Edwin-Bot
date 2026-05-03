"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoginModal } from "@/components/LoginModal";
import { LeadDrawer } from "@/components/LeadDrawer";

type LeadRecord = {
  id: number;
  name: string;
  phone: string;
  id_number: string;
  death_date: string;
  color: string;
  observations: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

type StatsResponse = {
  total: number;
  recycle: number;
  today: number;
  byColor: { green: number; yellow: number; red: number; purple: number };
};

type BlockedConversation = {
  phone: string;
  senderName: string;
  status: string;
  color: string;
  blockedAt: string;
  updatedAt: string;
  messageCount: number;
  blockedByExternalBlocklist: boolean;
};

type BlocklistEntry = {
  phone: string;
  seenByBot: boolean;
  status: string;
  senderName: string;
  updatedAt: string;
};

/** Same-origin /api/* — proxied to backend via next.config.js rewrites (avoids CORS when using 127.0.0.1 vs localhost). */
const API_BASE_URL = "";
const ENV_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "";
const STORAGE_KEY = "edwin_admin_token";

/** Table / export ordering: Verde → Amarillo → Morado → Rojo, then newest date. */
type LeadSortMode = "created" | "color_rank";

function buildHeaders(token: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function colorBadgeClasses(color: string) {
  const key = (color || "").toLowerCase();
  if (key === "green") return "bg-emerald-500/15 text-emerald-300 border-emerald-400/50";
  if (key === "yellow") return "bg-yellow-500/15 text-yellow-200 border-yellow-400/50";
  if (key === "red") return "bg-rose-500/15 text-rose-200 border-rose-400/50";
  return "bg-violet-500/15 text-violet-200 border-violet-400/50";
}

export default function HomePage() {
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const [rows, setRows] = useState<LeadRecord[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [actionId, setActionId] = useState<number | null>(null);
  const [blockedRows, setBlockedRows] = useState<BlockedConversation[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blocklistRows, setBlocklistRows] = useState<BlocklistEntry[]>([]);
  const [blocklistLoading, setBlocklistLoading] = useState(false);
  const [newBlockedPhone, setNewBlockedPhone] = useState("");
  const [blocklistActionPhone, setBlocklistActionPhone] = useState("");
  const [clearConversationPhone, setClearConversationPhone] = useState("");
  const [clearingConversations, setClearingConversations] = useState(false);

  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [color, setColor] = useState("");
  const [leadSort, setLeadSort] = useState<LeadSortMode>("created");
  const [view, setView] = useState<"active" | "recycle">("active");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [totalPages, setTotalPages] = useState(1);

  const [drawerLead, setDrawerLead] = useState<LeadRecord | null>(null);
  const [drawerConversation, setDrawerConversation] = useState<unknown>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (stored !== null) setToken(stored);
    else setToken(ENV_TOKEN);
    setHydrated(true);
  }, []);

  const authFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const headers = { ...buildHeaders(token), ...(init?.headers as Record<string, string>) };
      const response = await fetch(input, { ...init, headers });
      if (response.status === 401) {
        // Ignore stale 401 responses from requests that started before a successful login.
        const latestStored = sessionStorage.getItem(STORAGE_KEY) || ENV_TOKEN;
        if (!latestStored) {
          sessionStorage.removeItem(STORAGE_KEY);
          setToken("");
          setShowLogin(true);
        }
      }
      return response;
    },
    [token]
  );

  const subtitle = useMemo(() => {
    const parts = [];
    if (search) parts.push(`search: "${search}"`);
    if (color) parts.push(`color: ${color}`);
    if (leadSort === "color_rank") parts.push("sort: color rank");
    parts.push(view === "recycle" ? "recycle bin" : "active leads");
    return parts.join(" | ");
  }, [search, color, leadSort, view]);

  async function fetchStats() {
    const response = await authFetch(`${API_BASE_URL}/api/admin/stats`);
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Failed to load stats");
    }
    setStats(data.stats as StatsResponse);
  }

  async function fetchRows() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
        view,
      });
      if (search) query.set("search", search);
      if (color) query.set("color", color);
      if (leadSort === "color_rank") query.set("sort", "color_rank");

      const response = await authFetch(`${API_BASE_URL}/api/admin/leads?${query.toString()}`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to load lead records");
      }

      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotalPages(data?.pagination?.totalPages || 1);
    } catch (requestError) {
      console.error(requestError);
      setError(requestError instanceof Error ? requestError.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }

  async function fetchBlockedRows() {
    setBlockedLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/blocked-conversations`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to load blocked conversations");
      }
      setBlockedRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (requestError) {
      console.error(requestError);
      setError(requestError instanceof Error ? requestError.message : "Failed to load blocked conversations");
    } finally {
      setBlockedLoading(false);
    }
  }

  async function fetchBlocklistRows() {
    setBlocklistLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/blocklist`);
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to load blocklist");
      }
      setBlocklistRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (requestError) {
      console.error(requestError);
      setError(requestError instanceof Error ? requestError.message : "Failed to load blocklist");
    } finally {
      setBlocklistLoading(false);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    fetchRows();
    fetchBlockedRows();
    fetchBlocklistRows();
  }, [hydrated, page, search, color, leadSort, view, token]);

  useEffect(() => {
    if (!hydrated) return;
    fetchStats().catch((statsError) => {
      console.error(statsError);
      setError(statsError instanceof Error ? statsError.message : "Failed to load stats");
    });
  }, [hydrated, token]);

  async function openDrawer(row: LeadRecord) {
    setDrawerLead(row);
    setDrawerConversation(null);
    setDrawerLoading(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/leads/${row.id}`);
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Failed to load detail");
      setDrawerLead(data.lead as LeadRecord);
      setDrawerConversation(data.conversation ?? null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Detail load failed");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function handleSoftDelete(row: LeadRecord) {
    const ok = window.confirm(
      `Move lead #${row.id} (${row.phone}) to the recycle bin?\n\nYou can restore it later from Recycle bin.`
    );
    if (!ok) return;
    setActionId(row.id);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/leads/${row.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Delete failed");
      await Promise.all([fetchRows(), fetchStats()]);
      if (drawerLead?.id === row.id) setDrawerLead(null);
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleRestore(row: LeadRecord) {
    setActionId(row.id);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/leads/${row.id}/restore`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Restore failed");
      await Promise.all([fetchRows(), fetchStats()]);
      if (drawerLead?.id === row.id) setDrawerLead(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setActionId(null);
    }
  }

  async function handlePermanentDelete(row: LeadRecord) {
    const ok = window.confirm(
      `Permanently erase lead #${row.id} (${row.phone})?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setActionId(row.id);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/leads/${row.id}?permanent=true`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Permanent delete failed");
      await Promise.all([fetchRows(), fetchStats()]);
      if (drawerLead?.id === row.id) setDrawerLead(null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Permanent delete failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleExportCsv() {
    setError("");
    setSuccess("");
    try {
      const query = new URLSearchParams({ view });
      if (search) query.set("search", search);
      if (color) query.set("color", color);
      if (leadSort === "color_rank") query.set("sort", "color_rank");
      const response = await authFetch(`${API_BASE_URL}/api/admin/leads/export?${query.toString()}`);
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody?.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `leads_${view}_${Date.now()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  function applyFilters() {
    setPage(1);
    setSearch(searchDraft.trim());
  }

  async function handleAddToBlocklist() {
    const phone = newBlockedPhone.trim();
    if (!phone) return;
    setBlocklistActionPhone(phone);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/blocklist`, {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to add number");
      }
      setNewBlockedPhone("");
      await Promise.all([fetchBlocklistRows(), fetchBlockedRows()]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to add number");
    } finally {
      setBlocklistActionPhone("");
    }
  }

  async function handleRemoveFromBlocklist(phone: string) {
    const ok = window.confirm(`Remove ${phone} from blocked list?`);
    if (!ok) return;
    setBlocklistActionPhone(phone);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/blocklist/${encodeURIComponent(phone)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to remove number");
      }
      await Promise.all([fetchBlocklistRows(), fetchBlockedRows()]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to remove number");
    } finally {
      setBlocklistActionPhone("");
    }
  }

  async function handleClearConversationByPhone() {
    const phone = clearConversationPhone.trim();
    if (!phone) return;
    const ok = window.confirm(`Clear stored conversation for ${phone}?`);
    if (!ok) return;
    setClearingConversations(true);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/conversations/${encodeURIComponent(phone)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Failed to clear conversation");
      setClearConversationPhone("");
      await fetchBlockedRows();
      setSuccess("Conversation cleared.");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to clear conversation");
    } finally {
      setClearingConversations(false);
    }
  }

  async function handleClearAllConversations() {
    const ok = window.confirm("Clear ALL stored bot/customer conversations?\n\nThis cannot be undone.");
    if (!ok) return;
    setClearingConversations(true);
    setError("");
    setSuccess("");
    try {
      const response = await authFetch(`${API_BASE_URL}/api/admin/conversations`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Failed to clear all conversations");
      await fetchBlockedRows();
      const total = Number(data?.result?.totalCleared || 0);
      setSuccess(`All conversations cleared (${total}).`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to clear all conversations");
    } finally {
      setClearingConversations(false);
    }
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken("");
    setShowLogin(true);
  }

  function handleLoginSuccess(nextToken: string) {
    sessionStorage.setItem(STORAGE_KEY, nextToken);
    setToken(nextToken);
    setShowLogin(false);
    fetchStats().catch(() => {});
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading admin...
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      {showLogin ? (
        <LoginModal
          apiBaseUrl={API_BASE_URL}
          onSuccess={handleLoginSuccess}
          onClose={() => setShowLogin(false)}
        />
      ) : null}

      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-[0_0_80px_rgba(56,189,248,0.12)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300">Bot Admin</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Leads & archive</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              PostgreSQL leads with soft delete, recycle bin, CSV export, and conversation timeline from the bot store.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(STORAGE_KEY);
                setToken("");
                setShowLogin(true);
              }}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={logout}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-400 hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <article className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Active leads</p>
            <p className="mt-2 text-3xl font-semibold text-white">{stats?.total ?? "-"}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Recycle bin</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{stats?.recycle ?? "-"}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Today</p>
            <p className="mt-2 text-3xl font-semibold text-white">{stats?.today ?? "-"}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-400">Color mix</p>
            <p className="mt-2 text-sm text-slate-200">
              Verde {stats?.byColor?.green ?? 0} · Amarillo {stats?.byColor?.yellow ?? 0} · Morado{" "}
              {stats?.byColor?.purple ?? 0} · Rojo {stats?.byColor?.red ?? 0}
            </p>
          </article>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  setView("active");
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  view === "active" ? "bg-sky-500 text-slate-950" : "border border-white/10 text-slate-300"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => {
                  setPage(1);
                  setView("recycle");
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  view === "recycle" ? "bg-amber-500 text-slate-950" : "border border-white/10 text-slate-300"
                }`}
              >
                Recycle bin
              </button>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20"
            >
              Export CSV
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search name, phone, ID, death date, observations..."
              className="h-11 flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none focus:border-sky-400"
            />
            <select
              value={color}
              onChange={(event) => {
                setPage(1);
                setColor(event.target.value);
              }}
              className="h-11 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none focus:border-sky-400"
            >
              <option value="">All colors</option>
              <option value="green">Green</option>
              <option value="yellow">Yellow</option>
              <option value="purple">Purple</option>
              <option value="red">Red</option>
            </select>
            <select
              value={leadSort}
              onChange={(event) => {
                setPage(1);
                setLeadSort(event.target.value as LeadSortMode);
              }}
              className="h-11 min-w-[220px] rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none focus:border-sky-400"
              title="Row order for the table below (and CSV when exported)"
            >
              <option value="created">Sort: newest first</option>
              <option value="color_rank">Sort: Verde → Amarillo → Morado → Rojo</option>
            </select>
            <button
              type="button"
              onClick={applyFilters}
              className="h-11 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Apply
            </button>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {success}
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-slate-950/60 text-left text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">ID Number</th>
                  <th className="px-4 py-3 font-medium">Death Date</th>
                  <th className="px-4 py-3 font-medium">Color</th>
                  <th className="px-4 py-3 font-medium">Observations</th>
                  <th className="px-4 py-3 font-medium">{view === "recycle" ? "Removed at" : "Created"}</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 bg-slate-900/40 text-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Loading records...
                    </td>
                  </tr>
                ) : rows.length ? (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer hover:bg-white/5"
                      onClick={() => openDrawer(row)}
                    >
                      <td className="px-4 py-3">{row.name || "-"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.phone || "-"}</td>
                      <td className="px-4 py-3">{row.id_number || "-"}</td>
                      <td className="px-4 py-3">{row.death_date || "-"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${colorBadgeClasses(row.color)}`}>
                          {row.color || "purple"}
                        </span>
                      </td>
                      <td className="max-w-[240px] truncate px-4 py-3" title={row.observations || ""}>
                        {row.observations || "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {formatDate(view === "recycle" ? row.deleted_at || row.updated_at : row.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                        {view === "active" ? (
                          <button
                            type="button"
                            onClick={() => handleSoftDelete(row)}
                            disabled={actionId === row.id}
                            className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                          >
                            {actionId === row.id ? "..." : "Remove"}
                          </button>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleRestore(row)}
                              disabled={actionId === row.id}
                              className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-100"
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePermanentDelete(row)}
                              disabled={actionId === row.id}
                              className="rounded-lg border border-rose-500/60 bg-rose-600/20 px-2 py-1 text-xs text-rose-100"
                            >
                              Erase
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No records found with current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {subtitle} · Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                disabled={page <= 1}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={page >= totalPages}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-amber-300">Blocklist monitor</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Blocked by external blocklist</h2>
              <p className="text-sm text-slate-300">
                These chats are ignored by the bot because their numbers exist in `old_customers_blocklist.json`.
              </p>
            </div>
            <span className="rounded-full border border-amber-300/40 bg-amber-500/10 px-3 py-1 text-sm text-amber-200">
              {blockedRows.length} blocked
            </span>
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-slate-900/30 p-4">
            <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3">
              <p className="text-xs uppercase tracking-[0.15em] text-rose-200">Conversation archive cleanup</p>
              <div className="mt-2 flex flex-col gap-3 md:flex-row">
                <input
                  value={clearConversationPhone}
                  onChange={(event) => setClearConversationPhone(event.target.value)}
                  placeholder="Clear one conversation by phone"
                  className="h-11 flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none focus:border-rose-300"
                />
                <button
                  type="button"
                  onClick={handleClearConversationByPhone}
                  disabled={!clearConversationPhone.trim() || clearingConversations}
                  className="h-11 rounded-lg border border-rose-300/50 bg-rose-500/20 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-60"
                >
                  Clear by phone
                </button>
                <button
                  type="button"
                  onClick={handleClearAllConversations}
                  disabled={clearingConversations}
                  className="h-11 rounded-lg border border-rose-500/60 bg-rose-600/30 px-4 text-sm font-semibold text-rose-100 transition hover:bg-rose-600/40 disabled:opacity-60"
                >
                  Clear all conversations
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={newBlockedPhone}
                onChange={(event) => setNewBlockedPhone(event.target.value)}
                placeholder="Add phone to blocked list (e.g. +573001112233)"
                className="h-11 flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={handleAddToBlocklist}
                disabled={!newBlockedPhone.trim() || Boolean(blocklistActionPhone)}
                className="h-11 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
              >
                Add number
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="min-w-full divide-y divide-white/10 text-sm">
                <thead className="bg-slate-950/60 text-left text-slate-300">
                  <tr>
                    <th className="px-4 py-3 font-medium">Blocked phone</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
              </table>
              <div className="max-h-[250px] overflow-y-auto">
                <table className="min-w-full divide-y divide-white/10 text-sm">
                  <tbody className="divide-y divide-white/5 bg-slate-900/40 text-slate-100">
                    {blocklistLoading ? (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-slate-400">
                          Loading blocked numbers...
                        </td>
                      </tr>
                    ) : blocklistRows.length ? (
                      blocklistRows.map((row) => (
                        <tr key={row.phone}>
                          <td className="px-4 py-3 font-mono text-xs">{row.phone}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveFromBlocklist(row.phone)}
                              disabled={blocklistActionPhone === row.phone}
                              className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                            >
                              {blocklistActionPhone === row.phone ? "..." : "Remove"}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-4 py-6 text-center text-slate-400">
                          Blocked list is empty.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>

      {drawerLead ? (
        <LeadDrawer
          lead={drawerLead}
          conversation={drawerConversation as never}
          timelineLoading={drawerLoading}
          onClose={() => {
            setDrawerLead(null);
            setDrawerConversation(null);
          }}
        />
      ) : null}
    </main>
  );
}
