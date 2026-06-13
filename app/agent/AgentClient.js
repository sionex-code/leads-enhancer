"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import MobileNav from "../components/MobileNav";
import useSidebarCollapse from "../components/useSidebarCollapse";
import { Bot, Brain, ChevronDown, Database, FolderOpen, PanelLeftClose, PanelLeftOpen, Plus, Send, ShieldCheck, Sparkles, Square, Trash2, Wrench, Zap } from "lucide-react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

// GFM markdown (tables, lists, code) with raw HTML from the model escaped.
const mdRenderer = new marked.Renderer();
mdRenderer.html = ({ text }) => String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
marked.use({ renderer: mdRenderer, gfm: true, breaks: true });

async function jsonFetch(url, options = {}) {
  const res = await fetch(`${BASE_PATH}${url}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// Render the agent's markdown replies (GFM: tables, lists, code fences). Bare
// /api/agent/reports/... paths and naked URLs become links; root-relative
// hrefs get the basePath prefix; everything opens in a new tab.
function renderContent(text) {
  let src = String(text || "");
  src = src.replace(/(^|[\s(])(\/api\/agent\/reports\/[\w.\-]+\.html)/g, (_, pre, url) => `${pre}[open report](${url})`);
  src = src.replace(/(^|[\s(])(https?:\/\/[^\s)<\]]+)/g, (_, pre, url) => `${pre}[${url}](${url})`);
  let html;
  try {
    html = marked.parse(src);
  } catch {
    html = src.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>");
  }
  html = html
    .replace(/<a href="(\/[^"]*)"/g, `<a href="${BASE_PATH}$1"`)
    .replace(/<a /g, '<a target="_blank" rel="noopener" ');
  return { __html: html };
}

function ToolStep({ msg }) {
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

// All consecutive tool steps of a turn collapse into one "thinking" block.
function ThinkingBlock({ steps, live }) {
  const [open, setOpen] = useState(false);
  const calls = steps.filter((s) => s.kind === "tool-call");
  const tools = [...new Set(calls.map((s) => s.tool))];
  return (
    <div className={`think-block ${live ? "live" : ""}`}>
      <button className="think-head" onClick={() => setOpen(!open)}>
        <Brain size={13} />
        <span>
          {live ? "Thinking" : "Thought"} · {calls.length} tool {calls.length === 1 ? "call" : "calls"}
          {tools.length ? <span className="subtle"> · {tools.join(", ")}</span> : null}
        </span>
        <ChevronDown size={14} className={`chev ${open ? "open" : ""}`} />
      </button>
      {open && (
        <div className="think-body">
          {steps.map((m, i) => <ToolStep key={i} msg={m} />)}
        </div>
      )}
    </div>
  );
}

export default function AgentClient() {
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse();
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
      return data;
    } catch {
      return null;
    }
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
      const data = await loadSession(sessionId);
      const interval = data?.status === "thinking" ? 1200 : 4500;
      if (!cancelled) timer = setTimeout(tick, interval);
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

  async function stopAgent() {
    if (!sessionId) return;
    try {
      await jsonFetch("/api/agent", { method: "POST", body: JSON.stringify({ action: "stop", sessionId }) });
      await loadSession(sessionId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSession(id, e) {
    e?.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    await jsonFetch(`/api/agent?sessionId=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    if (id === sessionId) {
      setSessionId("");
      setSession(null);
    }
    loadSessions();
  }

  const thinking = session?.status === "thinking";
  const messages = session?.messages || [];
  const activeSession = sessions.find((s) => s.id === sessionId);

  // Group consecutive tool steps into one collapsible thinking block.
  const rendered = [];
  let group = null;
  messages.forEach((m, i) => {
    if (m.kind === "note") return;
    if (m.kind === "tool" || m.kind === "tool-call") {
      if (!group) {
        group = { steps: [], key: `g${i}` };
        rendered.push(group);
      }
      group.steps.push(m);
    } else {
      group = null;
      rendered.push({ msg: m, key: i });
    }
  });

  return (
    <main className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <ShieldCheck size={22} />
          <span className="brand-text">Lead Ops</span>
          <button
            className="icon sidebar-toggle"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        <nav className="nav">
          <Link className="nav-link" href="/" title="Projects">
            <FolderOpen size={15} /> <span className="nav-text">Projects</span>
          </Link>
          <Link className="nav-link" href="/leads" title="Leads"><Database size={15} /> <span className="nav-text">Leads</span></Link>
          <span className="nav-link active" title="Agent"><Bot size={15} /> <span className="nav-text">Agent</span></span>
        </nav>
        <button className="primary new-chat" onClick={() => { setSessionId(""); setSession(null); }}>
          <Plus size={15} /> <span className="nav-text">New chat</span>
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
            <div className="model-toggle" title="Fast = llama-3.1-8b-instant · Reasoning = llama-3.3-70b-versatile">
              <button className={model === "fast" ? "on" : ""} onClick={() => setModel("fast")}><Zap size={13} /> Fast</button>
              <button className={model === "reasoning" ? "on" : ""} onClick={() => setModel("reasoning")}><Brain size={13} /> Reasoning</button>
            </div>
            <button className="ghost" onClick={() => { setSessionId(""); setSession(null); }}>
              <Plus size={14} /> New
            </button>
            <button className="danger" disabled={!sessionId || thinking} onClick={(e) => removeSession(sessionId, e)} title="Delete current chat">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </header>

        {/* Mobile-only chat switcher (sidebar is hidden on phones) */}
        <div className="project-chips">
          <button className="chip-btn" onClick={() => { setSessionId(""); setSession(null); }}>
            <Plus size={13} /> New
          </button>
          {sessions.map((s) => (
            <span key={s.id} className={`chat-chip ${s.id === sessionId ? "active" : ""}`}>
              <button className="chat-chip-main" onClick={() => setSessionId(s.id)} title={s.title || "Chat"}>
                {s.status === "thinking" && <span className="run-dot" />}
                {(s.title || "Chat").slice(0, 26)}
              </button>
              <button className="chip-x" onClick={(e) => removeSession(s.id, e)} title="Delete chat">
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {!messages.length && (
            <div className="chat-empty">
              <Bot size={36} />
              <h2>{activeSession?.title || "What should I do?"}</h2>
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
          {rendered.map((item, idx) => {
            if (item.steps) {
              return <ThinkingBlock key={item.key} steps={item.steps} live={thinking && idx === rendered.length - 1} />;
            }
            const m = item.msg;
            return (
              <div key={item.key} className={`bubble ${m.role}`}>
                <div className="md" dangerouslySetInnerHTML={renderContent(m.content)} />
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
          {thinking ? (
            <button className="stop-btn" onClick={stopAgent} title="Stop the agent">
              <Square size={14} />
            </button>
          ) : (
            <button className="primary" disabled={!input.trim() || sending} onClick={send}>
              <Send size={16} />
            </button>
          )}
        </div>
      </section>
      <MobileNav active="agent" />
    </main>
  );
}
