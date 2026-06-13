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
const MAX_STEPS = 12;
const TOOL_RESULT_CHARS = 1400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Block until a project's background runner finishes the given stages (or times
// out / is stopped), polling its state file. This is what makes the agent
// autonomous: instead of firing a scrape and telling the user to "check status",
// a tool can await completion and then return the actual results in the same turn.
async function waitForProject(project, { ctx = {}, stages = ["scrape"], label = "working", timeoutMs = 10 * 60 * 1000, pollMs = 2500 } = {}) {
  const start = Date.now();
  let seenAlive = false;
  while (Date.now() - start < timeoutMs) {
    if (ctx.shouldStop && ctx.shouldStop()) return { finished: false, stopped: true };
    let s;
    try { s = store.loadStatus(project); } catch { s = null; }
    const state = s?.state || {};
    const alive = !!state.activeAlive;
    if (alive) seenAlive = true;
    const stageStates = state.stages || {};
    const rawCount = s?.counts?.raw || 0;
    const msg = state.message || "";
    if (ctx.setStatus) ctx.setStatus(`${label} ${project}… ${rawCount} leads so far`);
    const anyFailed = stages.some((name) => stageStates[name]?.status === "failed");
    // Wait for the runner PROCESS to actually exit — the runner syncs the leads
    // into the global DB AFTER a stage flips to "done", so returning on the stage
    // flag alone races that sync and yields empty results. Process-exit (message
    // Done/Failed, or pid no longer alive after we saw it) means the sync ran.
    const runnerDone = !alive && /^(Done|Failed|Stopped|Nothing)/i.test(msg);
    if (runnerDone || (seenAlive && !alive)) {
      return { finished: !anyFailed, failed: anyFailed, rawCount, message: msg, stages: Object.fromEntries(Object.entries(stageStates).map(([k, v]) => [k, v.status])) };
    }
    await sleep(pollMs);
  }
  return { finished: false, timedOut: true };
}

// Stop requests for in-flight turns. The stop action arrives via the same
// /api/agent route module that runs processTurn, so an in-memory set is safe.
const stopRequests = new Set();

function requestStop(sessionId) {
  const session = readSession(sessionId);
  if (!session) return { ok: false, error: "Session not found" };
  if (session.status !== "thinking") return { ok: true, note: "Agent is not running" };
  stopRequests.add(sessionId);
  session.statusDetail = "stopping…";
  writeSession(session);
  return { ok: true };
}

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
    watchlist: !!r.watchlist, contact_list: !!r.contact_list,
    email_status: r.email_status || "unset", outreach_status: r.outreach_status || "new",
    notes: r.notes ? String(r.notes).slice(0, 240) : "",
  };
}

// A lead row straight from a project's scraped CSV (loadStatus.leads), for
// showing the results of a fresh scrape without a DB round-trip.
function compactCsvLead(r) {
  return {
    name: r.name || "",
    phone: r.phone || "",
    domain: r.domain || "",
    website: r.website || "",
    rating: r.rating || "",
    category: r.category || "",
    email: r.email || "",
    address: r.address ? String(r.address).slice(0, 120) : "",
  };
}

const TOOLS = {
  list_projects: {
    description: "List all scraping projects with lead counts and running state. No args.",
    args: {},
    run: async () => store.listProjects().map((p) => ({ name: p.name, slug: p.slug, query: p.query, leads: p.counts?.raw || 0, running: p.running, watchlist: !!p.watchlist })),
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
    args: { project: "filter by project name", search: "text search (name/domain/phone/email/category/notes)", workflow: "optional: watchlist, contacts, email-ready, queued, sent, complete, skipped, needs-action", has_email: "true to only return leads that have an email", has_phone: "true to only return leads that have a phone number", limit: "max rows, default 20 (keep small!)" },
    run: async ({ project = "", search = "", workflow = "", has_email = false, has_phone = false, limit = 20 } = {}) => {
      const { total, rows } = db.queryLeads({
        project, search, workflow,
        hasEmail: has_email === true || has_email === "true",
        hasPhone: has_phone === true || has_phone === "true",
        limit: Math.min(Number(limit) || 20, 50),
      });
      return { total, shown: rows.length, leads: rows.map(compactLead) };
    },
  },
  update_lead_workflow: {
    description: "Update one lead's workflow fields: watchlist/contact list, email decision, outreach status, and notes.",
    args: { id: "lead id from get_leads", watchlist: "true/false optional", contact_list: "true/false optional", email_status: "unset|send|do_not_send|later optional", outreach_status: "new|queued|sent|complete|skipped optional", notes: "optional notes to save" },
    run: async (args = {}) => {
      if (!args.id) throw new Error("id required");
      const lead = db.updateLeadWorkflow(args.id, args);
      if (!lead) throw new Error("Lead not found");
      return { updated: compactLead(lead) };
    },
  },
  mark_message_sent: {
    description: "Mark a lead as contacted/message sent, optionally adding notes.",
    args: { id: "lead id from get_leads", notes: "optional notes about what was sent" },
    run: async ({ id, notes = "" } = {}) => {
      if (!id) throw new Error("id required");
      const current = db.getLead(id);
      if (!current) throw new Error("Lead not found");
      const nextNotes = notes ? [current.notes, `[${new Date().toISOString().slice(0, 10)}] ${notes}`].filter(Boolean).join("\n") : current.notes;
      const lead = db.updateLeadWorkflow(id, { contact_list: true, email_status: current.email_status === "unset" ? "send" : current.email_status, outreach_status: "sent", notes: nextNotes });
      return { updated: compactLead(lead) };
    },
  },
  complete_lead: {
    description: "Mark a lead workflow complete, optionally adding notes.",
    args: { id: "lead id from get_leads", notes: "optional completion notes" },
    run: async ({ id, notes = "" } = {}) => {
      if (!id) throw new Error("id required");
      const current = db.getLead(id);
      if (!current) throw new Error("Lead not found");
      const nextNotes = notes ? [current.notes, `[${new Date().toISOString().slice(0, 10)}] ${notes}`].filter(Boolean).join("\n") : current.notes;
      const lead = db.updateLeadWorkflow(id, { contact_list: true, outreach_status: "complete", notes: nextNotes });
      return { updated: compactLead(lead) };
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
  set_project_watchlist: {
    description: "Add or remove a scraping project from the project watch list.",
    args: { project: "project name or slug", watchlist: "true to watch, false to remove" },
    run: async ({ project, watchlist = true } = {}) => {
      if (!project) throw new Error("project required");
      return store.setProjectWatchlist(project, watchlist === true || watchlist === "true");
    },
  },
  delete_project: {
    description: "Delete a stopped scraping project and its output files. Refuses to delete a running project.",
    args: { project: "project name or slug" },
    run: async ({ project } = {}) => {
      if (!project) throw new Error("project required");
      const dir = store.safeProjectDir(project);
      const state = store.readState(dir);
      if (state.activePid && store.processAlive(state.activePid)) throw new Error("Stop the project before deleting it");
      store.deleteProject(project);
      return { deleted: true, project };
    },
  },
  capture_leads: {
    description: "Scrape a NEW batch of Google Maps leads and WAIT for it to finish, then return the leads directly. Scrape ONLY by default (no email enrichment). This is autonomous — by default it blocks until done and hands back the leads, so you can show them immediately in the same turn. Use has_phone/has_email to return only matching leads.",
    args: {
      project: "project name (new or existing — auto-named from the query if omitted)",
      query: "Maps search, e.g. 'dentists in Miami FL'",
      max: "number of leads, e.g. 30",
      enrich: "true to also run email/social enrichment after the scrape (only when the user explicitly asks for emails/socials)",
      has_phone: "true to return only the scraped leads that have a phone number",
      has_email: "true to return only the scraped leads that have an email (implies enrich)",
      wait: "default true — block until the scrape finishes and return the leads. Set false only for a huge scrape the user wants to run in the background.",
    },
    run: async ({ project, query, max = 20, enrich = false, has_phone = false, has_email = false, wait = true }, ctx = {}) => {
      if (!query) throw new Error("query is required");
      // Use a per-query project so a fresh scrape never mixes into an unrelated
      // existing project's leads. Slugified to a stable, collision-light name.
      const name = project || `${query.replace(/\s+in\s+/i, " ").replace(/[^a-z0-9 ]/gi, "").trim().slice(0, 40) || "leads"} leads`;
      const wantPhone = has_phone === true || has_phone === "true";
      const wantEmail = has_email === true || has_email === "true";
      const withEnrich = enrich === true || enrich === "true" || wantEmail;
      const stages = withEnrich ? ["scrape", "enrich"] : ["scrape"];
      const r = store.spawnRunner({ name, query, max: String(max), stages, enrichConcurrency: 16, auditConcurrency: 2, headless: true, network: true });
      const canonical = r.name || name;
      const shouldWait = wait !== false && wait !== "false";
      if (!shouldWait) {
        return { started: true, project: canonical, note: "Scrape running in background (wait=false). Poll project_status, or call wait_for_project to block until it's done." };
      }
      const w = await waitForProject(canonical, { ctx, stages, label: withEnrich ? "scraping+enriching" : "scraping" });
      if (w.stopped) return { stopped: true, project: canonical, note: "Stopped before the scrape finished." };
      // Make sure the just-scraped CSV is in the global DB for later tools, then
      // read THIS run's leads straight from the project (avoids the sync race and
      // case-sensitive DB project matching that returned empty before).
      try { store.syncProjectToDb(canonical); } catch {}
      let leads = [];
      try { leads = store.loadStatus(canonical).leads || []; } catch {}
      if (wantPhone) leads = leads.filter((l) => l.phone && String(l.phone).trim());
      if (wantEmail) leads = leads.filter((l) => l.email && String(l.email).trim());
      const shown = leads.slice(0, Math.min(Number(max) || 20, 50)).map(compactCsvLead);
      return {
        project: canonical,
        finished: w.finished,
        timed_out: !!w.timedOut,
        filtered_by: [wantPhone && "has_phone", wantEmail && "has_email"].filter(Boolean).join(",") || "none",
        captured: leads.length,
        shown: shown.length,
        leads: shown,
        note: shown.length
          ? "These are the ACTUAL scraped leads. Present ONLY these rows as a markdown table — do NOT add, rename, or invent any rows or businesses."
          : "The scrape returned 0 matching leads — the location may not have geocoded to the city the user meant, or nothing matched. Tell the user plainly that no leads were found and suggest a more specific area or query. NEVER invent leads.",
      };
    },
  },
  wait_for_project: {
    description: "Block until a project's running background job (scrape/enrich/whatsapp/audit) finishes, then return its final status. Use this to follow up on a background task instead of telling the user to check later.",
    args: { project: "project name or slug", stages: "optional comma list of stages to wait for (default: whatever is running)" },
    run: async ({ project, stages = "" }, ctx = {}) => {
      if (!project) throw new Error("project required");
      let wanted = String(stages).split(/[,\s]+/).filter(Boolean);
      if (!wanted.length) {
        const st = store.loadStatus(project);
        wanted = Object.entries(st.state?.stages || {}).filter(([, v]) => v.status === "running").map(([k]) => k);
        if (!wanted.length) wanted = ["scrape"];
      }
      const w = await waitForProject(project, { ctx, stages: wanted, label: "running" });
      return { project, ...w };
    },
  },
  enrich_leads: {
    description: "Find emails + social links for an existing project's leads by crawling their websites, and WAIT for it to finish (default), then report how many now have an email. Use get_leads with has_email after.",
    args: { project: "project name or slug", wait: "default true — block until enrichment finishes" },
    run: async ({ project, wait = true }, ctx = {}) => {
      if (!project) throw new Error("project required");
      store.spawnRunner({ name: project, stages: ["enrich"], enrichConcurrency: 16 });
      if (wait === false || wait === "false") return { started: true, project, note: "Enriching in background. Call wait_for_project to block until done." };
      const w = await waitForProject(project, { ctx, stages: ["enrich"], label: "enriching" });
      if (w.stopped) return { stopped: true, project };
      const withEmail = db.queryLeads({ project, hasEmail: true, limit: 1 }).total;
      return { project, finished: w.finished, timed_out: !!w.timedOut, leads_with_email: withEmail, note: "Enrichment done." };
    },
  },
  check_whatsapp: {
    description: "Check which of a project's lead phone numbers are on WhatsApp and WAIT for it to finish (default), then report results.",
    args: { project: "project name or slug", wait: "default true — block until the check finishes" },
    run: async ({ project, wait = true }, ctx = {}) => {
      if (!project) throw new Error("project required");
      store.spawnRunner({ name: project, stages: ["whatsapp"] });
      if (wait === false || wait === "false") return { started: true, project, note: "Checking in background. Call wait_for_project to block until done." };
      const w = await waitForProject(project, { ctx, stages: ["whatsapp"], label: "checking WhatsApp" });
      if (w.stopped) return { stopped: true, project };
      return { project, finished: w.finished, timed_out: !!w.timedOut, note: "WhatsApp check done — use get_leads to see the whatsapp column." };
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
  cancel_report_job: {
    description: "Cancel a running report generation job (kills the in-flight Lighthouse run).",
    args: { job_id: "id returned by generate_reports" },
    run: async ({ job_id }) => {
      const job = siteReport.cancelJob(job_id);
      if (!job) throw new Error("Unknown job id");
      return { status: job.status === "running" ? "cancelling" : job.status };
    },
  },
  stop_project: {
    description: "Stop a project's running background task (scrape/enrich/whatsapp/audit). Kills the worker process tree.",
    args: { project: "project name or slug" },
    run: async ({ project }) => {
      if (!project) throw new Error("project required");
      const dir = store.safeProjectDir(project);
      const state = store.readState(dir);
      const wasRunning = !!state.activePid;
      if (state.activePid) store.killTree(state.activePid);
      store.writeState(dir, { running: false, activePid: null, message: "Stopped", stoppedAt: new Date().toISOString() });
      return { stopped: true, wasRunning };
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
- YOU are the only one who can run tools. NEVER tell the user to "check status", "let me know", or describe which tool could be used — emit the json block and run it yourself, immediately. You are an autonomous agent: finish the job in this turn.
- When the user asks to scrape/get/find leads, call capture_leads and let it WAIT (default) — it returns the actual leads in its result. Then present them right away as a short markdown table (name, phone, domain, rating). Do NOT just say a scrape started.
- CRITICAL — NEVER fabricate leads. Show ONLY the exact rows present in the tool result's "leads" array, with their exact names/phones/domains. Do NOT add rows, invent businesses, autocomplete a list, or reuse names from earlier examples. If "leads" is empty or "shown" is 0, tell the user plainly that no leads were found (suggest a more specific area) — do NOT make any up. A made-up table is a serious failure.
- Geocoding note: some city names are ambiguous (e.g. "Islamabad" can resolve to Anantnag in Kashmir, India). If the returned leads' addresses are clearly in the wrong country/region, say so and suggest a more specific query like "restaurants in Islamabad, Pakistan" or a sector like "F-6 Islamabad Pakistan".
- Interpret the request and set the args: "get 30 leads from Miami with phone numbers" → capture_leads {query:"<business type> in Miami", max:30, has_phone:true}. If the business type is missing, infer it from context or ask one short question. "with emails"/"that have email" → has_email:true (this also enriches). "on whatsapp" → after scraping, call check_whatsapp then get_leads.
- Scraping is scrape-ONLY by default: do NOT enrich (no emails) unless the user explicitly asks for emails/socials.
- capture_leads, enrich_leads, check_whatsapp, and wait_for_project block until the work is done and hand back results — use them; don't fire-and-forget. Only set wait:false if the user explicitly wants a big scrape to run in the background, and then offer to check back.
- Reports (generate_reports) run minutes-long as a job: start it, then you MAY poll report_job_status once; if not done, give the job id and tell the user it's generating. When done, give links: /api/agent/reports/<file>.
- Lead workflow fields are real CRM state. Use update_lead_workflow, mark_message_sent, and complete_lead when the user asks to watch, contact, note, mark sent, skip, or complete leads.
- Never invent data; always read it via tools. Keep answers short and concrete.
- BE FAST: take the fewest steps possible. If a question needs no data (greetings, "what can you do", clarifying), answer directly with NO tool call. Don't call list_projects/project_status just to confirm something you already know — the selected project is given above. Use exactly the one tool the task needs, then answer.
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
  const recent = (session.messages || []).slice(-16);
  let budget = 12000;
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
    let nudges = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (stopRequests.has(sessionId)) {
        push(session, { role: "assistant", content: "Stopped. Tell me how to continue." });
        break;
      }
      session.statusDetail = step === 0 ? "planning" : "reviewing tool result";
      writeSession(session);
      const reply = await llm.chat(buildMessages(session), { model: session.model || "fast", maxTokens: 1200, temperature: 0.2 });
      if (stopRequests.has(sessionId)) {
        push(session, { role: "assistant", content: "Stopped. Tell me how to continue." });
        break;
      }
      const call = parseToolCall(reply);

      if (!call) {
        // The model sometimes narrates "use the get_leads tool" instead of
        // calling it. Nudge it (hidden from the chat UI) and retry.
        const mentionsTool = Object.keys(TOOLS).some((t) => reply.includes(t));
        if (mentionsTool && nudges < 2) {
          nudges++;
          push(session, { role: "user", kind: "note", content: "SYSTEM: You must run the tool yourself NOW. Reply with ONLY the fenced json tool call, nothing else." });
          continue;
        }
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
        // ctx lets long-running tools stream live status into the session file
        // (the UI polls it) and notice a stop request mid-wait.
        const ctx = {
          shouldStop: () => stopRequests.has(sessionId),
          setStatus: (detail) => {
            const s = readSession(sessionId);
            if (s) { s.statusDetail = detail; writeSession(s); }
          },
        };
        try {
          result = await tool.run(call.args || {}, ctx);
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
    stopRequests.delete(sessionId);
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

module.exports = { sendMessage, requestStop, readSession, listSessions, deleteSession, TOOLS };
