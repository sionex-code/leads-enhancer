// Lead Ops AI agent: a LangGraph-style state graph (agent node ⇄ tool node) over
// the Kiro proxy. The proxy strips OpenAI `tools`, so tool use is prompt-based:
// the model replies with a fenced ```json {"tool": ..., "args": ...}``` block,
// we execute it, append the observation, and loop (max 8 steps per turn).
//
// Sessions are persisted at output/agent/sessions/<id>.json; the UI polls them.

const fs = require("fs");
const path = require("path");
const llm = require("./llm.cjs");
const store = require("./store.cjs");
const db = require("./db.cjs");
const siteReport = require("./site-report.cjs");

const SESSIONS_DIR = path.join(process.cwd(), "output", "agent", "sessions");
const MAX_STEPS = 8;
const TOOL_RESULT_CHARS = 2200;

function ensure() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id) {
  const file = path.resolve(SESSIONS_DIR, `${String(id).replace(/[^a-z0-9-]/gi, "")}.json`);
  if (!file.startsWith(path.resolve(SESSIONS_DIR) + path.sep)) throw new Error("Bad session id");
  return file;
}

function readSession(id) {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(id), "utf8"));
  } catch {
    return null;
  }
}

function writeSession(session) {
  ensure();
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2), "utf8");
  return session;
}

function listSessions() {
  ensure();
  return fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8"));
        const firstUser = (s.messages || []).find((m) => m.role === "user");
        return { id: s.id, title: s.title || firstUser?.content?.slice(0, 60) || "New chat", project: s.project || "", status: s.status, updatedAt: s.updatedAt };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function deleteSession(id) {
  try { fs.unlinkSync(sessionPath(id)); } catch {}
}

// ---- tools -------------------------------------------------------------------
function compactLead(r) {
  const socials = ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok"].filter((k) => r[k]);
  return {
    id: r.id, name: r.name, domain: r.domain || "", phone: r.phone || "", email: r.email || "",
    category: r.category || "", rating: r.rating || "", project: r.project || "",
    whatsapp: r.whatsapp_status || "", socials: socials.join(",") || "",
    perf_d: r.desktop_performance, seo_d: r.desktop_seo, perf_m: r.mobile_performance, seo_m: r.mobile_seo,
  };
}

const TOOLS = {
  list_projects: {
    description: "List all scraping projects with lead counts and running state. No args.",
    args: {},
    run: async () => store.listProjects().map((p) => ({ name: p.name, slug: p.slug, query: p.query, leads: p.counts?.raw || 0, running: p.running })),
  },
  project_status: {
    description: "Status of one project: stage states, counts, latest message.",
    args: { project: "project name or slug" },
    run: async ({ project }) => {
      const s = store.loadStatus(project);
      const stages = Object.fromEntries(Object.entries(s.state?.stages || {}).map(([k, v]) => [k, v.status]));
      return { name: s.name, query: s.query, running: !!s.state?.activeAlive, message: s.state?.message || "", stages, counts: s.counts };
    },
  },
  get_leads: {
    description: "Query leads from the global database. All args optional.",
    args: { project: "filter by project name", search: "text search (name/domain/phone/email/category)", has_email: "true to only return leads with an email", limit: "max rows, default 20 (keep small!)" },
    run: async ({ project = "", search = "", has_email = false, limit = 20 } = {}) => {
      const { total, rows } = db.queryLeads({ project, search, hasEmail: has_email === true || has_email === "true", limit: Math.min(Number(limit) || 20, 50) });
      return { total, shown: rows.length, leads: rows.map(compactLead) };
    },
  },
  delete_lead: {
    description: "Delete lead(s) from the global database. Provide id (preferred, from get_leads) OR domain.",
    args: { id: "lead id", domain: "website domain, e.g. example.com" },
    run: async ({ id, domain } = {}) => {
      if (id) return { deleted: db.deleteLead(id) };
      if (domain) return { deleted: db.deleteLeadsWhere({ domain }) };
      throw new Error("Provide id or domain");
    },
  },
  capture_leads: {
    description: "Start a NEW Google Maps scrape (runs scrape→enrich in background). Returns immediately; check project_status for progress.",
    args: { project: "project name (new or existing)", query: "Maps search, e.g. 'plumbers in Austin TX'", max: "number of leads, e.g. 20" },
    run: async ({ project, query, max = 20 }) => {
      if (!project || !query) throw new Error("project and query are required");
      const r = store.spawnRunner({ name: project, query, max: String(max), stages: ["scrape", "enrich"], enrichConcurrency: 16, auditConcurrency: 2, headless: true, network: true });
      return { started: true, slug: r.slug, note: "Scrape+enrich running in background. Poll project_status." };
    },
  },
  enrich_leads: {
    description: "Re-run email/social enrichment for an existing project's leads (background).",
    args: { project: "project name or slug" },
    run: async ({ project }) => {
      const r = store.spawnRunner({ name: project, stages: ["enrich"], enrichConcurrency: 16 });
      return { started: true, slug: r.slug };
    },
  },
  check_whatsapp: {
    description: "Check which of a project's lead phone numbers are on WhatsApp (background).",
    args: { project: "project name or slug" },
    run: async ({ project }) => {
      const r = store.spawnRunner({ name: project, stages: ["whatsapp"] });
      return { started: true, slug: r.slug };
    },
  },
  inspect_website: {
    description: "Quickly fetch ONE website right now: title, meta, tech stack, social links, emails. Fast (seconds), no Lighthouse.",
    args: { url: "website URL or domain" },
    run: async ({ url }) => {
      if (!url) throw new Error("url required");
      const r = await siteReport.inspectWebsite(url);
      return { url: r.url, online: r.ok, status: r.status, https: r.https, responseMs: r.responseMs, title: r.title, description: r.description, tech: r.tech, socials: r.socials, emails: r.emails, error: r.error };
    },
  },
  generate_reports: {
    description: "Generate an independent in-depth report (live inspection + Lighthouse desktop+mobile + social media + AI analysis) for up to 5 websites. Takes several minutes — returns a job_id immediately; poll report_job_status until done.",
    args: { websites: "array of up to 5 website URLs/domains (or lead domains)", project: "optional: pull business details for these domains from this project's leads" },
    run: async ({ websites = [], project = "" } = {}) => {
      const list = (Array.isArray(websites) ? websites : String(websites).split(/[,\s]+/)).filter(Boolean).slice(0, siteReport.MAX_SITES);
      if (!list.length) throw new Error("Provide 1-5 websites");
      const sites = list.map((w) => {
        const domain = db.hostOf(w);
        const { rows } = db.queryLeads({ search: domain, limit: 1, project });
        const lead = rows.find((r) => r.domain === domain) || rows[0];
        return lead ? { ...lead, website: lead.website || w } : { name: domain, website: w };
      });
      const jobId = siteReport.startReportJob(sites);
      return { job_id: jobId, sites: sites.map((s) => s.domain || db.hostOf(s.website)), note: "Running in background (~1-3 min per site). Poll report_job_status with this job_id. Do NOT poll more than once per response." };
    },
  },
  report_job_status: {
    description: "Check a report generation job. When done, each result has a `report` file — the user can open it at /api/agent/reports/<file>.",
    args: { job_id: "id returned by generate_reports" },
    run: async ({ job_id }) => {
      const job = siteReport.getJob(job_id);
      if (!job) throw new Error("Unknown job id");
      return { status: job.status, error: job.error || "", progress: (job.log || []).slice(-4), results: job.results || [] };
    },
  },
};

function toolDocs() {
  return Object.entries(TOOLS)
    .map(([name, t]) => {
      const args = Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join("; ") || "none";
      return `- ${name}: ${t.description} Args: ${args}`;
    })
    .join("\n");
}

function systemPrompt(session) {
  return `You are Lead Ops Agent, an autonomous assistant inside a Google Maps lead-generation dashboard. You manage scraping projects, a global leads database, and website analysis reports.

${session.project ? `The user has selected project: "${session.project}". Default to it when a tool needs a project.` : "No project selected — use list_projects if you need one."}

TOOLS:
${toolDocs()}

HOW TO CALL A TOOL — reply with ONLY a fenced json block, nothing else:
\`\`\`json
{"tool": "get_leads", "args": {"project": "Austin", "limit": 10}}
\`\`\`
One tool call per reply. After you receive the TOOL RESULT, either call another tool or give your final answer as plain text (no json block).

RULES:
- Never invent data; always read it via tools.
- Background tasks (scrape/enrich/whatsapp/reports) return immediately — report the started state and job/project to poll; do not loop on status checks more than twice in one turn. Tell the user to ask "check status" later.
- When reports finish, give the user links: /api/agent/reports/<file>.
- Keep answers short and concrete. Use markdown lists/tables sparingly.
- Deleting leads is permanent — only delete what the user explicitly asked for, and confirm what was deleted.`;
}

// Parse a {"tool":...} call out of the model reply (fenced or bare).
function parseToolCall(text) {
  const fenced = text.match(/```(?:json|tool)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  const bare = text.match(/\{[\s\S]*"tool"[\s\S]*\}/);
  if (bare) candidates.push(bare[0]);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj.tool === "string") return { tool: obj.tool, args: obj.args || {} };
    } catch {}
  }
  return null;
}

// Build the LLM message window: system + recent turns, with old tool output trimmed.
function buildMessages(session) {
  const msgs = [{ role: "system", content: systemPrompt(session) }];
  const recent = (session.messages || []).slice(-24);
  let budget = 26000;
  const rendered = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    let content = m.content || "";
    if (m.kind === "tool" ) content = `TOOL RESULT (${m.tool}):\n${content.slice(0, TOOL_RESULT_CHARS)}`;
    if (budget - content.length < 0) break;
    budget -= content.length;
    rendered.unshift({ role: m.kind === "tool" ? "user" : m.role, content });
  }
  return msgs.concat(rendered);
}

function push(session, msg) {
  session.messages.push({ ...msg, ts: new Date().toISOString() });
  writeSession(session);
}

// ---- the graph loop -----------------------------------------------------------
async function processTurn(sessionId) {
  const session = readSession(sessionId);
  if (!session || session.status === "thinking") return;
  session.status = "thinking";
  writeSession(session);

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await llm.chat(buildMessages(session), { model: session.model || "fast", maxTokens: 1600 });
      const call = parseToolCall(reply);

      if (!call) {
        push(session, { role: "assistant", content: reply.trim() });
        break;
      }

      push(session, { role: "assistant", kind: "tool-call", tool: call.tool, content: "```json\n" + JSON.stringify({ tool: call.tool, args: call.args }) + "\n```" });

      let result;
      const tool = TOOLS[call.tool];
      if (!tool) {
        result = { error: `Unknown tool "${call.tool}". Available: ${Object.keys(TOOLS).join(", ")}` };
      } else {
        session.statusDetail = `running ${call.tool}`;
        writeSession(session);
        try {
          result = await tool.run(call.args || {});
        } catch (err) {
          result = { error: String(err && err.message || err).slice(0, 400) };
        }
      }
      push(session, { role: "user", kind: "tool", tool: call.tool, content: JSON.stringify(result) });

      if (step === MAX_STEPS - 1) {
        push(session, { role: "assistant", content: "I hit the per-turn step limit. Ask me to continue to keep going." });
      }
    }
  } catch (err) {
    push(session, { role: "assistant", content: `Something went wrong talking to the model: ${String(err && err.message || err).slice(0, 300)}` });
  } finally {
    const s = readSession(sessionId);
    if (s) {
      s.status = "idle";
      s.statusDetail = "";
      writeSession(s);
    }
  }
}

function sendMessage({ sessionId, message, project, model }) {
  let session = sessionId ? readSession(sessionId) : null;
  if (!session) {
    session = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(message || "").slice(0, 60),
      project: project || "",
      model: model || "fast",
      status: "idle",
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }
  if (project !== undefined) session.project = project;
  if (model) session.model = model;
  if (session.status === "thinking") throw new Error("Agent is still working on the previous message");
  push(session, { role: "user", content: String(message || "").slice(0, 8000) });
  // fire and forget — the UI polls the session file
  processTurn(session.id).catch(() => {});
  return { sessionId: session.id };
}

module.exports = { sendMessage, readSession, listSessions, deleteSession, TOOLS };
