"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MobileNav from "../components/MobileNav";
import { Bot, Brain, Database, FolderOpen, Plus, Send, ShieldCheck, Sparkles, Trash2, Wrench, Zap } from "lucide-react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// Render the agent's markdown-ish replies: links (incl. bare /api/agent/reports/...
// paths become clickable), bold, lists, code fences.
function renderContent(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = esc(String(text || ""));
  html = html.replace(/```(?:json|tool)?\n?([\s\S]*?)```/g, (_, code) => `<pre>${code.trim()}</pre>`);
  html = html.replace(/\[([^\]]+)\]\((\/[^)\s]+|https?:[^)\s]+)\)/g, (_, label, url) =>
    `<a href="${url.startsWith("/") ? BASE_PATH + url : url}" target="_blank">${label}</a>`);
  html = html.replace(/(^|[\s(])(\/api\/agent\/reports\/[\w.\-]+\.html)/g, (_, pre, url) =>
    `${pre}<a href="${BASE_PATH}${url}" target="_blank">open report</a>`);
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank">${url}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/^[-*] (.*)$/gm, "<li>$1</li>").replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");
  html = html.replace(/\n{2,}/g, "<br/><br/>").replace(/\n/g, "<br/>");
  return { __html: html };
}

function ToolChip({ msg }) {
  const [open, setOpen] = useState(false);
  let pretty = msg.content;
  try {
    const raw = msg.kind === "tool-call" ? msg.content.replace(/```(?:json)?\n?|```/g, "") : msg.content;
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {}
  return (
    <div className={`tool-chip ${msg.kind}`}>
      <button className="tool-chip-head" onClick={() => setOpen(!open)}>
        <Wrench size={13} />
        {msg.kind === "tool-call" ? `calling ${msg.tool}` : `${msg.tool} result`}
        <span className="subtle">{open ? "hide" : "show"}</span>
      </button>
      {open && <pre>{pretty.slice(0, 4000)}</pre>}
    </div>
  );
}

export default function AgentClient() {
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState("");
  const [model, setModel] = useState("fast");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const loadSessions = useCallback(async () => {
    try {
      const data = await jsonFetch("/api/agent");
      setSessions(data.sessions || []);
    } catch {}
  }, []);

  const loadSession = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await jsonFetch(`/api/agent?sessionId=${encodeURIComponent(id)}`);
      if (sessionIdRef.current !== id) return;
      setSession(data);
      if (data.project) setProject(data.project);
      if (data.model) setModel(data.model);
    } catch {}
  }, []);

  useEffect(() => {
    loadSessions();
    jsonFetch("/api/projects").then((d) => setProjects(d.projects || [])).catch(() => {});
  }, [loadSessions]);

  // poll the open session while the agent is thinking (and slowly otherwise)
  useEffect(() => {
    setSession(null);
    if (!sessionId) return;
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      await loadSession(sessionId);
      if (!cancelled) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, loadSession]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [session?.messages?.length, session?.status]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await jsonFetch("/api/agent", {
        method: "POST",
        body: JSON.stringify({ sessionId, message, project, model }),
      });
      setInput("");
      if (data.sessionId !== sessionId) setSessionId(data.sessionId);
      else await loadSession(sessionId);
      loadSessions();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    await jsonFetch(`/api/agent?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    if (id === sessionId) {
      setSessionId("");
      setSession(null);
    }
    loadSessions();
  }

  const thinking = session?.status === "thinking";
  const messages = session?.messages || [];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={22} />
          <span>Lead Ops</span>
        </div>
        <nav className="nav">
          <Link className="nav-link" href="/">Projects</Link>
          <Link className="nav-link" href="/leads"><Database size={15} /> Leads</Link>
          <span className="nav-link active"><Bot size={15} /> Agent</span>
        </nav>
        <button className="primary new-chat" onClick={() => { setSessionId(""); setSession(null); }}>
          <Plus size={15} /> New chat
        </button>
        <div className="project-list">
          {sessions.map((s) => (
            <button key={s.id} className={`project-item ${s.id === sessionId ? "active" : ""}`} onClick={() => setSessionId(s.id)}>
              <span>
                <strong>{s.status === "thinking" && <span className="run-dot" />}{s.title || "Chat"}</strong>
                <br />
                <span className="subtle">{s.project || "no project"}</span>
              </span>
              <span className="session-del" onClick={(e) => removeSession(s.id, e)} title="Delete chat"><Trash2 size={13} /></span>
            </button>
          ))}
          {!sessions.length && <div className="subtle">No chats yet</div>}
        </div>
      </aside>

      <section className="project-main agent-main">
        <header className="topbar">
          <div>
            <h1><Sparkles size={18} style={{ verticalAlign: "-3px" }} /> AI Agent</h1>
            <div className="subtle">Scrape, enrich, audit, manage leads and generate website reports — by chat.</div>
          </div>
          <div className="agent-controls">
            <label className="agent-select">
              <FolderOpen size={14} />
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.slug} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <div className="model-toggle" title="Fast = gemma-4-26b-a4b-it · Reasoning = gemma-4-31b-it">
              <button className={model === "fast" ? "on" : ""} onClick={() => setModel("fast")}><Zap size={13} /> Fast</button>
              <button className={model === "reasoning" ? "on" : ""} onClick={() => setModel("reasoning")}><Brain size={13} /> Reasoning</button>
            </div>
          </div>
        </header>

        {/* Mobile-only chat switcher (sidebar is hidden on phones) */}
        <div className="project-chips">
          <button className="chip-btn" onClick={() => { setSessionId(""); setSession(null); }}>
            <Plus size={13} /> New
          </button>
          {sessions.map((s) => (
            <button key={s.id} className={`chip-btn ${s.id === sessionId ? "active" : ""}`} onClick={() => setSessionId(s.id)}>
              {s.status === "thinking" && <span className="run-dot" />}
              {(s.title || "Chat").slice(0, 26)}
            </button>
          ))}
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {!messages.length && (
            <div className="chat-empty">
              <Bot size={36} />
              <h2>What should I do?</h2>
              <div className="suggestions">
                {[
                  "Capture 20 new leads: dentists in Miami FL",
                  "Show me leads with no email and re-enrich them",
                  "Generate reports for the 3 worst-performing websites",
                  "Which leads are on WhatsApp?",
                ].map((s) => (
                  <button key={s} onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            if (m.kind === "note") return null;
            if (m.kind === "tool" || m.kind === "tool-call") return <ToolChip key={i} msg={m} />;
            return (
              <div key={i} className={`bubble ${m.role}`}>
                <div dangerouslySetInnerHTML={renderContent(m.content)} />
              </div>
            );
          })}
          {thinking && (
            <div className="bubble assistant thinking">
              <span className="dots"><i /><i /><i /></span>
              {session?.statusDetail || "thinking"}
            </div>
          )}
        </div>

        {error && <div className="chat-error">{error}</div>}
        <div className="chat-input">
          <textarea
            placeholder={thinking ? "Agent is working…" : "Ask the agent — e.g. “scrape 20 plumbers in Dallas and report on the top 5 sites”"}
            value={input}
            rows={2}
            disabled={thinking}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="primary" disabled={!input.trim() || sending || thinking} onClick={send}>
            <Send size={16} />
          </button>
        </div>
      </section>
      <MobileNav active="agent" />
    </main>
  );
}
