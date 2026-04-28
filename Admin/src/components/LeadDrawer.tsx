"use client";

type MessageItem = {
  role?: string;
  text?: string;
  at?: string;
  rawType?: string;
};

type Conversation = {
  phone?: string;
  messages?: MessageItem[];
  status?: string;
  color?: string;
  metadata?: Record<string, unknown>;
};

type Lead = {
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

type Props = {
  lead: Lead;
  conversation: Conversation | null;
  timelineLoading?: boolean;
  onClose: () => void;
};

function formatWhen(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function LeadDrawer({ lead, conversation, timelineLoading, onClose }: Props) {
  const messages = [...(conversation?.messages || [])].sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" role="dialog">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close panel" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-400">Lead #{lead.id}</p>
            <h2 className="mt-1 text-xl font-semibold text-white">{lead.name || "—"}</h2>
            <p className="mt-1 font-mono text-sm text-slate-300">{lead.phone}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Close
          </button>
        </header>

        <div className="space-y-3 overflow-y-auto border-b border-white/10 p-5 text-sm">
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-slate-300">
            <dt className="text-slate-500">ID number</dt>
            <dd>{lead.id_number || "—"}</dd>
            <dt className="text-slate-500">Death date</dt>
            <dd>{lead.death_date || "—"}</dd>
            <dt className="text-slate-500">Color</dt>
            <dd className="capitalize">{lead.color || "—"}</dd>
            <dt className="text-slate-500">Created</dt>
            <dd>{formatWhen(lead.created_at)}</dd>
            <dt className="text-slate-500">Observations</dt>
            <dd className="whitespace-pre-wrap">{lead.observations || "—"}</dd>
            {conversation?.metadata ? (
              <>
                <dt className="text-slate-500">Chat status</dt>
                <dd>{conversation.status || "—"}</dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-white/10 px-5 py-3">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Conversation timeline</p>
            <p className="text-xs text-slate-500">
              Loaded from server chat archive when available (<code className="text-sky-400">data-store.json</code>).
            </p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-900/40 p-4">
            {timelineLoading ? (
              <p className="text-center text-sm text-slate-400">Loading timeline...</p>
            ) : !messages.length ? (
              <p className="text-center text-sm text-slate-500">No messages stored for this phone yet.</p>
            ) : (
              messages.map((msg, idx) => {
                const isBot = msg.role === "bot";
                return (
                  <div key={`${msg.at || idx}-${idx}`} className={`flex ${isBot ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[92%] rounded-2xl px-4 py-2 text-sm ${
                        isBot ? "bg-slate-800 text-slate-100" : "bg-sky-600/30 text-sky-50"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        {isBot ? "Bot" : "Customer"} {msg.rawType === "audio" ? "· voice" : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed">{msg.text || "(empty)"}</p>
                      <p className="mt-1 text-right text-[10px] text-slate-500">{formatWhen(msg.at)}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
