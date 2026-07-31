const app = document.querySelector("#app");
const config = window.EN_MARCHA_SUPABASE_CONFIG || {};
const supabaseClient = window.supabase?.createClient?.(config.url, config.publishableKey);

const PROFILES = {
  "dinero-sin-filtro": { name: "Dinero Sin Filtro", color: "#55d6ae", meta: "Español · 1.700–1.800 palabras", workflow: [
    ["idea", "Idea", "Marc"], ["script", "Guion y aprobación", "Marc"], ["visual", "Producción visual", "Ainhoa"], ["editing", "Edición", "Marc"], ["published", "Publicado", "Marc"],
  ] },
  "why-things": { name: "WhyThings", color: "#f5a75a", meta: "Inglés · 1.000–1.100 palabras · 5–8 min", workflow: [
    ["idea", "Idea e investigación", "Ainhoa"], ["script", "Guion", "Ainhoa"], ["production_pack", "PDFs y prompts", "Ainhoa"], ["visual", "Producción visual", "Ainhoa"], ["editing", "Edición", "Marc"], ["published", "Publicado", "Marc"],
  ] },
};
const STAGE_TO_STATUS = { idea: "pending", script: "progress", production_pack: "progress", visual: "waiting", editing: "progress", published: "completed" };
const STATUS_LABELS = { pending: "Pendiente", progress: "En curso", waiting: "En espera", completed: "Completado", skipped: "No publicado" };
let realtimeChannel;
let state = { session: null, workspace: null, channels: [], entries: [], ideas: [], activity: [], page: "today", selectedDate: iso(new Date()), weekStart: monday(iso(new Date())), month: new Date(), modal: null, selectedVideo: null, selectedIdea: null, message: "", error: "", migrationRequired: false, ideaFilter: "all" };
const detailsSaveInFlight = new Set();

function iso(value) { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function withTimeout(promise, milliseconds) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), milliseconds))]); }
function httpsUrl(value) { const raw = String(value || "").trim(); if (!raw) return null; try { const parsed = new URL(raw); return parsed.protocol === "https:" ? parsed.href : null; } catch { return null; } }
function date(value) { return new Date(`${value}T12:00:00`); }
function addDays(value, amount) { const next = date(value); next.setDate(next.getDate() + amount); return iso(next); }
function monday(value) { const current = date(value); const offset = (current.getDay() + 6) % 7; current.setDate(current.getDate() - offset); return iso(current); }
function formatDate(value, options = { weekday: "long", day: "numeric", month: "long" }) { return new Intl.DateTimeFormat("es-ES", options).format(date(value)); }
function capitalise(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function esc(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function profile(channelId) { return PROFILES[channelId] || { name: "Canal", color: "#9aa5b5", meta: "Canal personalizado", workflow: [["idea", "Idea", "Marc"], ["editing", "Edición", "Marc"], ["published", "Publicado", "Marc"]] }; }
function channel(channelId) { return state.channels.find((item) => item.id === channelId) || { id: channelId, ...profile(channelId) }; }
function workflow(channelId) { return profile(channelId).workflow; }
function stage(channelId, stageKey) { return workflow(channelId).find(([key]) => key === stageKey) || workflow(channelId)[0]; }
function ownerFor(entry) { return stage(entry.channel_id || entry.channelId, entry.current_stage || entry.currentStage)[2]; }
function stageLabel(entry) { return entry.status === "skipped" ? "No publicado" : stage(entry.channel_id || entry.channelId, entry.current_stage || entry.currentStage)[1]; }
function entryStage(entry) { return entry.current_stage || entry.currentStage || "idea"; }
function stageExists(channelId, stageKey) { return workflow(channelId).some(([key]) => key === stageKey); }
function isSkipped(entry) { return entry.status === "skipped"; }
function isPublished(entry) { return entryStage(entry) === "published"; }
function currentUserName() { return state.session?.user?.email?.split("@")[0] || "Equipo"; }
function createUuid() { if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => { const value = Math.floor(Math.random() * 16); return (character === "x" ? value : (value & 0x3) | 0x8).toString(16); }); }
function showIdeaMessage(message) { const node = document.querySelector("#idea-form [data-form-message]"); if (node) { node.textContent = message; node.hidden = false; } else toast(message); }
function icon(name) { const paths = { spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>', plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>', ideas: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.7.5 1 1.2 1 2.1V17h6v-.2c0-.9.3-1.6 1-2.1A7 7 0 0 0 12 2Z"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6M12 7v5l3 2"/>', activity: '<path d="M3 12h3l2-7 4 14 2-7h7"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6.6 17l.1-.1A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.5-1H5v-3h.2A1.7 1.7 0 0 0 6.7 10 1.7 1.7 0 0 0 6.4 8l-.1-.1L8.4 5.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1A1.7 1.7 0 0 0 19.1 10a1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.2 1Z"/>', arrowLeft: '<path d="m15 18-6-6 6-6"/>', arrowRight: '<path d="m9 18 6-6-6-6"/>', trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6M14 10v6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>', link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.2-1.2"/>' }; return `<svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`; }

async function boot() {
  if (!(config.url && config.publishableKey && supabaseClient)) { state.error = "No se pudo cargar la conexión compartida."; render(); return; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js?v=15").catch(() => {});
  render();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => { state.session = session; state.workspace = null; state.channels = []; state.entries = []; state.ideas = []; state.activity = []; state.error = ""; if (session) await loadMemberships(); render(); });
  try {
    const { data, error } = await withTimeout(supabaseClient.auth.getSession(), 4000);
    if (error) throw error;
    state.session = data.session;
    if (state.session) await loadMemberships();
  } catch (error) {
    console.warn("No se pudo recuperar la sesión a tiempo.", error);
    state.message = "La comprobación automática está tardando. Puedes introducir tu correo para entrar igualmente.";
  }
  render();
}
async function loadMemberships() {
  const { data, error } = await supabaseClient.from("workspace_members").select("workspaces(id,name,invite_code)").eq("user_id", state.session.user.id);
  if (error) { state.error = "No se pudo abrir el espacio compartido."; return; }
  const workspaces = (data || []).map((row) => Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces).filter(Boolean);
  state.workspace = workspaces.find((item) => item.id === localStorage.getItem("en-marcha-workspace")) || workspaces[0] || null;
  if (state.workspace) { localStorage.setItem("en-marcha-workspace", state.workspace.id); await ensureChannels(); await loadAll(); subscribe(); }
}
async function ensureChannels() { const rows = Object.entries(PROFILES).map(([id,item]) => ({ workspace_id: state.workspace.id, id, name: item.name, color: item.color })); await supabaseClient.from("channels").upsert(rows, { onConflict: "workspace_id,id", ignoreDuplicates: true }); }
async function loadAll(options = {}) {
  const preserveView = Boolean(options.preserveView);
  if (!state.workspace) return false;
  const [channels, entries, ideas, activity] = await Promise.all([
    supabaseClient.from("channels").select("id,name,color").eq("workspace_id", state.workspace.id).order("created_at"),
    supabaseClient.from("video_entries").select("id,idea_id,channel_id,title,scheduled_for,status,current_stage,format,notes,resource_url,completed_at,created_at").eq("workspace_id", state.workspace.id).order("scheduled_for"),
    supabaseClient.from("content_ideas").select("id,channel_id,title,format,notes,priority,status,created_at").eq("workspace_id", state.workspace.id).order("created_at", { ascending: false }),
    supabaseClient.from("activity_events").select("id,message,event_type,video_entry_id,idea_id,created_at").eq("workspace_id", state.workspace.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (ideas.error?.code === "42P01" || activity.error?.code === "42P01" || entries.error?.message?.includes("current_stage")) { state.migrationRequired = true; return false; }
  if (channels.error || entries.error || ideas.error || activity.error) {
    if (!preserveView) state.error = "No se pudieron cargar los datos del equipo.";
    return false;
  }
  state.error = "";
  state.channels = channels.data || [];
  state.entries = entries.data || [];
  state.ideas = ideas.data || [];
  state.activity = activity.data || [];
  return true;
}
function subscribe() { if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel); let timer; const refresh = () => { clearTimeout(timer); timer = setTimeout(async () => { if (await loadAll({ preserveView: true })) render(); }, 250); }; realtimeChannel = supabaseClient.channel(`en-marcha-v2-${state.workspace.id}`).on("postgres_changes", { event: "*", schema: "public", table: "channels", filter: `workspace_id=eq.${state.workspace.id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "video_entries", filter: `workspace_id=eq.${state.workspace.id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "content_ideas", filter: `workspace_id=eq.${state.workspace.id}` }, refresh).on("postgres_changes", { event: "*", schema: "public", table: "activity_events", filter: `workspace_id=eq.${state.workspace.id}` }, refresh).subscribe(); }

function render() {
  if (state.error) { app.innerHTML = accessShell("Revisa la conexión", state.error); return; }
  if (!state.session) { app.innerHTML = signIn(); return; }
  if (!state.workspace) { app.innerHTML = workspaceChoice(); return; }
  if (state.migrationRequired) { app.innerHTML = migrationScreen(); return; }
  const view = { today: todayView, ideas: ideasView, week: weekView, history: historyView, activity: activityView, settings: settingsView }[state.page] || todayView;
  app.innerHTML = `<div class="app-shell">${sidebar()}<main class="main"><header class="topbar"><div class="crumb">${icon("spark")}<span>${esc(state.workspace.name)} · Espacio compartido</span></div><div class="topbar-actions"><button class="secondary-button" data-action="new-idea">${icon("ideas")} Idea</button><button class="primary-button" data-action="new-video">${icon("plus")} Nuevo vídeo</button></div></header><section class="view">${view()}</section></main></div>${state.modal ? modal() : ""}<div id="toast" class="toast"></div>`;
}
function accessShell(title, text) { return `<main class="access-page"><section class="access-card"><div class="access-mark">${icon("spark")}</div><p class="eyebrow">EN MARCHA</p><h1>${esc(title)}</h1><p>${esc(text)}</p></section></main>`; }
function signIn() { return `<main class="access-page"><section class="access-card"><div class="access-mark">${icon("spark")}</div><p class="eyebrow">EN MARCHA · ESPACIO COMPARTIDO</p><h1>Tu producción, en el mismo sitio.</h1><p>Abre el enlace de acceso en este mismo navegador.</p><form id="login-form" class="access-form"><label>Correo electrónico</label><input name="email" type="email" required placeholder="tu@email.com"/><button class="primary-button access-button">Enviar enlace de acceso</button></form>${state.message ? `<p class="access-message">${esc(state.message)}</p>` : ""}</section></main>`; }
function workspaceChoice() { return `<main class="access-page"><section class="access-card workspace-card"><div class="access-mark">${icon("spark")}</div><p class="eyebrow">EN MARCHA · EQUIPO</p><h1>Prepara vuestro espacio.</h1><div class="workspace-choice-grid"><form id="create-workspace" class="workspace-choice"><h2>Crear espacio</h2><p>Solo para la primera persona del equipo.</p><label>Nombre</label><input name="name" value="Producción YouTube" required maxlength="80"/><button class="primary-button">Crear y continuar</button></form><form id="join-workspace" class="workspace-choice"><h2>Unirme al equipo</h2><p>Pega el código que te han enviado.</p><label>Código</label><input name="code" required maxlength="8" pattern="[0-9A-Fa-f]{8}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="A1B2C3D4"/><button class="secondary-button">Unirme</button></form></div>${state.message ? `<p class="access-message">${esc(state.message)}</p>` : ""}</section></main>`; }
function migrationScreen() { return `<main class="access-page"><section class="access-card workspace-card"><div class="access-mark">${icon("spark")}</div><p class="eyebrow">ACTUALIZACIÓN NECESARIA</p><h1>La nueva producción está lista.</h1><p>Solo falta ejecutar la migración V2 de Supabase. Se usa una única vez y presupone que la instalación inicial ya está hecha.</p><ol class="migration-steps"><li>En el repositorio, abre <strong>supabase-v2.sql</strong>.</li><li>Copia su contenido en Supabase → <strong>SQL Editor</strong>.</li><li>Pulsa <strong>Run</strong> y recarga esta página.</li></ol></section></main>`; }
function sidebar() { const tabs = [["today","Hoy","file"],["ideas","Ideas","ideas"],["week","Semana","calendar"],["history","Historial","history"],["activity","Actividad","activity"],["settings","Ajustes","settings"]]; return `<aside class="sidebar"><div class="brand"><span class="brand-mark">${icon("spark")}</span><span>En Marcha<small>Control de contenidos</small></span></div><p class="nav-label">Espacio de trabajo</p><nav class="nav-group">${tabs.map(([id,label,shape]) => `<button class="nav-item ${state.page === id ? "active" : ""}" data-page="${id}">${icon(shape)}<span>${label}</span></button>`).join("")}</nav><p class="nav-label">Tus canales</p><div class="channel-list">${state.channels.map((item) => `<button class="channel-link" data-filter-channel="${item.id}"><i class="channel-dot" style="background:${item.color}"></i><span class="channel-name">${esc(item.name)}</span></button>`).join("")}</div><div class="sidebar-footer"><strong>Marc + Ainhoa</strong>El vídeo siempre está en manos de alguien.</div></aside>`; }
function ownerBadge(owner) { return `<span class="owner-badge ${owner === "Ainhoa" ? "ainhoa" : "marc"}"><i></i>${owner}</span>`; }
function stageBadge(entry) { return `<span class="stage-badge ${isSkipped(entry) ? "skipped" : entryStage(entry)}">${esc(stageLabel(entry))}</span>`; }
function overdue(entry) { return !isPublished(entry) && !isSkipped(entry) && entry.scheduled_for < iso(new Date()); }
function card(entry, compact = false) { const current = channel(entry.channel_id); return `<article class="video-card ${overdue(entry) ? "overdue" : ""}" data-open-video="${entry.id}"><div class="video-card-top"><span class="channel-pill"><i style="background:${current.color}"></i>${esc(current.name)}</span>${stageBadge(entry)}</div><h3>${esc(entry.title)}</h3><div class="video-card-bottom">${ownerBadge(ownerFor(entry))}<span>${capitalise(new Intl.DateTimeFormat("es-ES", { day:"numeric", month:"short" }).format(date(entry.scheduled_for)))}</span></div>${compact ? "" : `<p class="video-card-next">${overdue(entry) ? "Necesita atención" : `Ahora lo tiene ${ownerFor(entry)}`}</p>`}</article>`; }
function dailyTask(entry) { const current = channel(entry.channel_id); const published = isPublished(entry); return `<article class="task-card daily-task ${overdue(entry) ? "overdue" : ""}" data-open-video="${entry.id}"><span class="task-state ${published ? "completed" : entryStage(entry)}">${published ? icon("check") : icon("file")}</span><div class="task-content"><span class="channel-pill"><i style="background:${current.color}"></i>${esc(current.name)}</span><p class="task-title">${esc(entry.title)}</p><div class="task-meta">${stageBadge(entry)}${ownerBadge(ownerFor(entry))}${overdue(entry) ? '<span class="late-text">Fecha pasada</span>' : ""}</div></div><span class="daily-task-arrow">${icon("arrowRight")}</span></article>`; }
function nextSchedule(entry) { const current = channel(entry.channel_id); const scheduled = date(entry.scheduled_for); return `<article class="next-item" data-open-video="${entry.id}"><div class="next-date">${scheduled.getDate()}<small>${new Intl.DateTimeFormat("es-ES", { month:"short" }).format(scheduled).replace(".", "")}</small></div><div class="next-copy"><strong>${esc(entry.title)}</strong><span><i class="channel-dot" style="background:${current.color};display:inline-block;margin-right:4px"></i>${esc(current.name)} · ${esc(stageLabel(entry))}</span></div></article>`; }
function todayView() { const today = iso(new Date()); const entries = state.entries.filter((item) => item.scheduled_for === state.selectedDate).sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || a.created_at.localeCompare(b.created_at)); const published = entries.filter(isPublished).length; const active = entries.filter((item) => !isPublished(item) && !isSkipped(item)).length; const late = entries.filter(overdue).length; const percent = entries.length ? Math.round((published / entries.length) * 100) : 0; const future = state.entries.filter((item) => item.scheduled_for > state.selectedDate && !isPublished(item) && !isSkipped(item)).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, 4); return `<div class="page-intro daily-intro"><div><p class="eyebrow">PLAN DEL DÍA</p><h1>${capitalise(formatDate(state.selectedDate))}</h1><p class="subtext">${state.selectedDate === today ? "Un vídeo a la vez. Haz visible el siguiente paso." : "Revisa lo previsto y actualiza su fase cuando avancéis."}</p></div><div class="date-switcher" aria-label="Cambiar fecha"><button data-day="-1" aria-label="Día anterior">${icon("arrowLeft")}</button><input type="date" value="${state.selectedDate}" data-date-input aria-label="Fecha seleccionada"/><button data-day="1" aria-label="Día siguiente">${icon("arrowRight")}</button></div></div><div class="stat-grid daily-stats"><article class="stat-card ink"><span class="stat-label">Programados</span><div class="stat-value">${entries.length}</div><p class="stat-detail">para este día</p></article><article class="stat-card"><span class="stat-label">Publicados</span><div class="stat-value">${published}</div><p class="stat-detail">vídeos terminados</p></article><article class="stat-card purple"><span class="stat-label">En marcha</span><div class="stat-value">${active}</div><p class="stat-detail">con relevo activo</p></article><article class="stat-card orange"><span class="stat-label">Retrasos</span><div class="stat-value">${late}</div><p class="stat-detail">necesitan atención</p></article></div><div class="dashboard-grid daily-dashboard"><section class="panel daily-plan"><div class="panel-head"><div class="panel-title"><span class="panel-title-icon">${icon("file")}</span><div><h2>Lo que toca</h2><p class="subtext">Abre un vídeo para ver quién lo tiene y pasarle el relevo.</p></div></div><button class="text-button" data-action="new-video">+ Añadir</button></div>${entries.length ? `<div class="task-list">${entries.map(dailyTask).join("")}</div>` : `<div class="empty-state"><div class="empty-symbol">${icon("check")}</div><h3>Sin vídeos para este día</h3><p>Planifica el siguiente vídeo para tener el día claro.</p><button class="primary-button" data-action="new-video">${icon("plus")} Añadir vídeo</button></div>`}</section><aside class="side-stack"><section class="panel progress-card"><h2>Ritmo del día</h2><p class="subtext">${published} de ${entries.length} publicados.</p><div class="progress-wrap"><div class="progress-ring" style="--progress:${percent * 3.6}deg"><strong>${percent}%</strong></div><div class="progress-copy"><strong>${entries.length && published === entries.length ? "Día despejado" : "Sigue con el siguiente vídeo"}</strong><span>${active ? `${active} todavía ${active === 1 ? "está" : "están"} en producción.` : "No queda ningún relevo activo."}</span></div></div></section><section class="panel"><div class="panel-head"><div><h2>Próximamente</h2><p class="subtext">La siguiente cola de publicación.</p></div><button class="text-button" data-page="week">Ver semana</button></div><div class="next-list">${future.length ? future.map(nextSchedule).join("") : '<div class="empty-state"><p>No hay nada pendiente después de este día.</p></div>'}</div></section></aside></div>`; }
function emptyQueue(text) { return `<div class="empty-queue">${icon("check")}<span>${text}</span></div>`; }
function ideasView() { const ideas = state.ideaFilter === "all" ? state.ideas : state.ideas.filter((idea) => idea.channel_id === state.ideaFilter); return `<div class="page-intro"><div><h1>Biblioteca de ideas</h1><p class="subtext">Guarda cualquier idea antes de decidir cuándo merece convertirse en vídeo.</p></div><button class="primary-button" data-action="new-idea">${icon("plus")} Nueva idea</button></div><div class="idea-filters"><button class="filter-chip ${state.ideaFilter === "all" ? "active" : ""}" data-idea-filter="all">Todas</button>${state.channels.map((item) => `<button class="filter-chip ${state.ideaFilter === item.id ? "active" : ""}" data-idea-filter="${item.id}">${esc(item.name)}</button>`).join("")}</div><section class="idea-grid">${ideas.length ? ideas.map((idea) => { const current = channel(idea.channel_id); const linkedVideo = state.entries.find((entry) => entry.idea_id === idea.id); const scheduled = idea.status === "scheduled"; return `<article class="idea-card"><div><span class="channel-pill"><i style="background:${current.color}"></i>${esc(current.name)}</span><span class="priority ${idea.priority}">${idea.priority === "high" ? "Prioridad alta" : idea.priority === "low" ? "Baja prioridad" : "Normal"}</span></div><h2>${esc(idea.title)}</h2><p>${esc(idea.notes || "Sin notas todavía.")}</p><div class="idea-card-footer"><span>${esc(idea.format || "Sin formato")}</span>${scheduled ? `<button class="secondary-button" data-open-video="${linkedVideo?.id || ""}" ${linkedVideo ? "" : "disabled"}>${linkedVideo ? "Abrir vídeo" : "Programada"}</button>` : `<button class="secondary-button" data-promote-idea="${idea.id}">Programar</button>`}</div><div class="idea-card-actions"><button class="idea-action" data-edit-idea="${idea.id}">${icon("file")} Editar</button><button class="idea-action delete" data-delete-idea="${idea.id}">${icon("trash")} Eliminar</button></div></article>`; }).join("") : `<div class="empty-wide"><h2>Aquí vivirán las ideas que todavía no tienen fecha.</h2><button class="primary-button" data-action="new-idea">Añadir primera idea</button></div>`}</section>`; }
function weekView() { const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index)); const weekEntries = state.entries.filter((item) => item.scheduled_for >= state.weekStart && item.scheduled_for <= days[6]); return `<div class="page-intro"><div><h1>Esta semana</h1><p class="subtext">Planificación por fecha y persona responsable.</p></div><div class="week-switch"><button data-week="-7">${icon("arrowLeft")}</button><strong>${capitalise(formatDate(state.weekStart, { day:"numeric", month:"short" }))} — ${capitalise(formatDate(days[6], { day:"numeric", month:"short" }))}</strong><button data-week="7">${icon("arrowRight")}</button></div></div><div class="week-grid">${days.map((day) => { const items = weekEntries.filter((item) => item.scheduled_for === day); return `<section class="week-day ${day === iso(new Date()) ? "today" : ""}"><header><span>${new Intl.DateTimeFormat("es-ES", { weekday:"short" }).format(date(day))}</span><strong>${date(day).getDate()}</strong></header>${items.length ? items.map((item) => card(item, true)).join("") : '<p class="week-empty">Sin publicación</p>'}</section>`; }).join("")}</div>`; }
function historyView() { const entries = [...state.entries].sort((a,b) => b.scheduled_for.localeCompare(a.scheduled_for)); return `<div class="page-intro"><div><h1>Historial</h1><p class="subtext">Todo el contenido, desde la idea hasta la publicación.</p></div></div><section class="panel history-panel"><div class="history-table-wrap"><table class="history-table"><thead><tr><th>Vídeo</th><th>Canal</th><th>Ahora lo tiene</th><th>Fecha</th><th>Fase</th></tr></thead><tbody>${entries.map((item) => { const current = channel(item.channel_id); return `<tr data-open-video="${item.id}"><td class="title-cell"><strong>${esc(item.title)}</strong></td><td><span class="channel-pill"><i style="background:${current.color}"></i>${esc(current.name)}</span></td><td>${ownerBadge(ownerFor(item))}</td><td>${capitalise(new Intl.DateTimeFormat("es-ES", { day:"numeric", month:"short" }).format(date(item.scheduled_for)))}</td><td>${stageBadge(item)}</td></tr>`; }).join("")}</tbody></table></div></section>`; }
function activityView() { return `<div class="page-intro"><div><h1>Actividad reciente</h1><p class="subtext">Los últimos relevos y cambios del equipo.</p></div></div><section class="panel activity-panel">${state.activity.length ? state.activity.map((event) => `<article class="activity-row"><span class="activity-icon">${icon(event.event_type.includes("idea") ? "ideas" : event.event_type === "stage_changed" ? "activity" : "file")}</span><div><strong>${esc(event.message)}</strong><span>${new Intl.DateTimeFormat("es-ES", { dateStyle:"medium", timeStyle:"short" }).format(new Date(event.created_at))}</span></div></article>`).join("") : '<div class="empty-wide"><h2>Los cambios del equipo aparecerán aquí.</h2></div>'}</section>`; }
function settingsView() { return `<div class="page-intro"><div><h1>Ajustes</h1><p class="subtext">El relevo se asigna automáticamente según el canal y la fase.</p></div></div><div class="settings-grid"><section class="panel settings-panel team-panel"><span class="shared-label">ESPACIO COMPARTIDO</span><h2>${esc(state.workspace.name)}</h2><p>Comparte este código con Ainhoa para que se una al mismo panel.</p><div class="invite-code"><span>${esc(state.workspace.invite_code)}</span><button class="secondary-button" data-action="copy-code">Copiar código</button></div><button class="secondary-button" data-action="logout">Cerrar sesión</button></section>${Object.entries(PROFILES).map(([id,item]) => `<section class="panel settings-panel workflow-card"><span class="workflow-dot" style="background:${item.color}"></span><h2>${item.name}</h2><p>${item.meta}</p><div class="workflow-mini">${item.workflow.map(([, label, owner]) => `<div><span>${esc(label)}</span>${ownerBadge(owner)}</div>`).join("")}</div></section>`).join("")}</div>`; }
function modal() { if (state.modal === "idea") return ideaModal(); if (state.modal === "video") return videoModal(); if (state.modal === "detail") return detailModal(); return ""; }
function modalShell(title, subtitle, body) { return `<div class="modal-backdrop" data-modal-backdrop><section class="modal ${state.modal === "detail" ? "detail-modal" : ""}"><div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-close-modal>${icon("close")}</button></div>${body}</section></div>`; }
function ideaModal() { const idea = state.selectedIdea; const editing = Boolean(idea?.id); const isScheduled = idea?.status === "scheduled"; return modalShell(editing ? "Editar idea" : "Nueva idea", editing ? (isScheduled ? "Esta idea ya tiene un vídeo programado. El canal se corrige desde la ficha del vídeo." : "Corrige el enfoque, el canal o la prioridad antes de programarla.") : "No necesita fecha todavía. Solo tiene que ser buena.", `<form id="idea-form" novalidate><input type="hidden" name="id" value="${idea?.id || ""}"/><div class="form-field"><label>Idea o título provisional</label><input name="title" required maxlength="150" autofocus value="${esc(idea?.title || "")}" placeholder="Ej. Por qué gastar con tarjeta duele menos"/></div><div class="form-grid"><div class="form-field"><label>Canal</label><select name="channelId" required ${isScheduled ? "disabled" : ""}>${state.channels.map((item) => `<option value="${item.id}" ${idea?.channel_id === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>${isScheduled ? `<input type="hidden" name="channelId" value="${esc(idea.channel_id)}"/>` : ""}</div><div class="form-field"><label>Formato</label><input name="format" maxlength="60" value="${esc(idea?.format || "")}" placeholder="POV, análisis, niveles…"/></div></div><div class="form-field"><label>Notas</label><textarea name="notes" rows="4" placeholder="Gancho, enfoque o dato que no quieres perder.">${esc(idea?.notes || "")}</textarea></div><div class="form-field"><label>Prioridad</label><select name="priority"><option value="normal" ${idea?.priority === "normal" || !idea ? "selected" : ""}>Normal</option><option value="high" ${idea?.priority === "high" ? "selected" : ""}>Alta</option><option value="low" ${idea?.priority === "low" ? "selected" : ""}>Baja</option></select></div><p class="form-message" data-form-message role="alert" hidden></p><div class="form-actions"><button type="button" class="cancel-button" data-close-modal>Cancelar</button><button type="button" class="primary-button" onclick="submitIdeaForm(this.form)">${editing ? "Guardar cambios" : "Guardar idea"}</button></div></form>`); }
function videoModal() { const idea = state.selectedVideo?.idea; return modalShell("Programar vídeo", idea ? "Esta idea pasará a formar parte del calendario." : "Crea un vídeo y el relevo se asignará automáticamente.", `<form id="video-form"><input type="hidden" name="ideaId" value="${idea?.id || ""}"/><div class="form-field"><label>Tema o título</label><input name="title" required maxlength="150" autofocus value="${esc(idea?.title || "")}" placeholder="Ej. Cómo tu cerebro gasta tu nómina"/></div><div class="form-grid"><div class="form-field"><label>Canal</label><select name="channelId">${state.channels.map((item) => `<option value="${item.id}" ${idea?.channel_id === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div><div class="form-field"><label>Fecha de publicación</label><input name="date" type="date" value="${state.selectedDate}" required/></div></div><div class="form-field"><label>Formato</label><input name="format" value="${esc(idea?.format || "")}" maxlength="60" placeholder="Opcional"/></div><div class="form-field"><label>Nota inicial</label><textarea name="notes" rows="3">${esc(idea?.notes || "")}</textarea></div><p class="assignment-hint">El primer relevo se asigna solo según el canal: Marc para Dinero Sin Filtro y Ainhoa para WhyThings.</p><div class="form-actions"><button type="button" class="cancel-button" data-close-modal>Cancelar</button><button class="primary-button">Programar vídeo</button></div></form>`); }
function detailModal() { const entry = state.entries.find((item) => item.id === state.selectedVideo?.id); if (!entry) return ""; const resourceUrl = httpsUrl(entry.resource_url); const current = channel(entry.channel_id); const stages = workflow(entry.channel_id); const currentIndex = stages.findIndex(([key]) => key === entryStage(entry)); const next = stages[currentIndex + 1]; return modalShell(esc(entry.title), `${esc(current.name)} · Publicación ${capitalise(formatDate(entry.scheduled_for, { day:"numeric", month:"long" }))}`, `<div class="detail-content"><section class="detail-summary"><div class="detail-meta">${stageBadge(entry)}${overdue(entry) ? '<span class="overdue-label">Fecha pasada</span>' : ""}</div><div class="detail-now"><span>Ahora lo tiene</span>${ownerBadge(ownerFor(entry))}</div></section><section class="workflow-panel"><div class="workflow-panel-head"><div><span class="section-kicker">FLUJO DE PRODUCCIÓN</span><h3>${esc(stageLabel(entry))}</h3><p>${isPublished(entry) ? "Este vídeo ya está publicado." : `El siguiente relevo está preparado para ${next ? next[2] : ownerFor(entry)}.`}</p></div>${next ? `<button class="primary-button advance-stage" data-next-stage="${entry.id}">Pasar a ${next[1]} <span>· ${next[2]}</span></button>` : ""}</div><div class="stage-rail" aria-label="Fases de producción">${stages.map(([key,label,owner], index) => `<button class="stage-rail-step ${index < currentIndex ? "done" : ""} ${index === currentIndex ? "current" : ""}" data-set-stage="${key}" data-video-id="${entry.id}"><span class="stage-number">${index < currentIndex ? icon("check") : index + 1}</span><span class="stage-rail-copy"><strong>${esc(label)}</strong>${ownerBadge(owner)}</span></button>`).join("")}</div></section><form id="details-form" class="detail-form"><input type="hidden" name="id" value="${entry.id}"/><div class="form-field"><label>Título</label><input name="title" required maxlength="150" value="${esc(entry.title)}"/></div><div class="form-grid"><div class="form-field"><label>Canal</label><select name="channelId">${state.channels.map((item) => `<option value="${item.id}" ${item.id === entry.channel_id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></div><div class="form-field"><label>Fecha de publicación</label><input name="date" type="date" required value="${esc(entry.scheduled_for)}"/></div></div><p class="correction-hint">Puedes corregir canal y fecha. Si el nuevo canal no tiene la fase actual, el vídeo volverá a <strong>Idea</strong>.</p><div class="form-field"><label>Notas</label><textarea name="notes" rows="4" placeholder="Qué falta, qué se ha decidido o qué debe saber la otra persona.">${esc(entry.notes || "")}</textarea></div><div class="form-field"><label>Enlace a carpeta, guion o edición</label><input name="resourceUrl" type="url" value="${esc(entry.resource_url || "")}" placeholder="https://drive.google.com/..."/></div><div class="detail-save-bar">${resourceUrl ? `<a class="secondary-button" href="${esc(resourceUrl)}" target="_blank" rel="noreferrer">${icon("link")} Abrir recurso</a>` : ""}<button type="submit" class="primary-button" data-save-details onclick="event.preventDefault(); submitDetailsForm(this.form)">Guardar cambios</button></div><section class="danger-zone"><div><strong>Eliminar vídeo</strong><p>Se quitará del calendario. Si nació de una idea, esa idea volverá a estar disponible.</p></div><button type="button" class="danger-button" data-action="delete-video" data-video-id="${entry.id}">${icon("trash")} Eliminar</button></section></form></div>`); }

async function log(eventType, message, videoId = null, ideaId = null) { return supabaseClient.from("activity_events").insert({ workspace_id: state.workspace.id, actor_id: state.session.user.id, event_type: eventType, message: `${currentUserName()}: ${message}`, video_entry_id: videoId, idea_id: ideaId }); }
async function login(email) { state.message = "Enviando enlace…"; render(); const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${location.pathname}` } }); state.message = error ? "No se pudo enviar el enlace. Prueba otra vez." : "Revisa tu correo y abre el enlace en este mismo navegador."; render(); }
async function createWorkspace(name) { const { data, error } = await supabaseClient.rpc("create_workspace", { workspace_name: name }); if (error || !data?.[0]) { state.message = "No se pudo crear el espacio."; render(); return; } state.workspace = data[0]; localStorage.setItem("en-marcha-workspace", state.workspace.id); await ensureChannels(); await loadAll(); subscribe(); render(); }
async function joinWorkspace(rawCode) { const code = String(rawCode || "").trim().toUpperCase().replace(/\s/g, ""); if (!/^[0-9A-F]{8}$/.test(code)) { state.message = "El código debe tener exactamente 8 caracteres: letras A–F y números."; render(); return; } state.message = "Comprobando el código…"; render(); const { data, error } = await supabaseClient.rpc("join_workspace", { code_to_join: code }); if (error) { console.warn("No se pudo unir al espacio.", error); if (error.message === "Invite code not found") state.message = "No encontramos ese código. Copiad de nuevo los 8 caracteres de Ajustes."; else if (/Authentication required/i.test(error.message)) state.message = "Tu sesión ha caducado. Vuelve a entrar con el enlace enviado a tu correo."; else if (/join_workspace|schema cache|function/i.test(error.message)) state.message = "La conexión compartida necesita una actualización en Supabase. Avisad a Marc."; else state.message = "No se pudo comprobar el código. Revisa internet e inténtalo otra vez."; render(); return; } if (!data?.[0]) { state.message = "El espacio no respondió al intento de unión. Inténtalo una vez más."; render(); return; } state.workspace = data[0]; localStorage.setItem("en-marcha-workspace", state.workspace.id); await ensureChannels(); await loadAll(); subscribe(); render(); toast("Ya estás dentro del espacio compartido."); }
async function saveIdea(form) {
  const id = String(form.get("id") || "");
  const record = { channel_id: form.get("channelId"), title: String(form.get("title")).trim(), format: String(form.get("format")).trim() || null, notes: String(form.get("notes")).trim(), priority: form.get("priority") };
  if (!record.title) { document.querySelector('#idea-form [name="title"]')?.focus(); return showIdeaMessage("Escribe un título para guardar la idea."); }
  if (!state.channels.some((item) => item.id === record.channel_id)) return showIdeaMessage("Elige uno de los canales para guardar la idea.");

  if (id) {
    const idea = state.ideas.find((item) => item.id === id);
    if (!idea) return toast("No encontramos esa idea.");
    if (idea.status === "scheduled" && idea.channel_id !== record.channel_id) return toast("Cambia el canal desde la ficha del vídeo programado.");
    const { error } = await supabaseClient.from("content_ideas").update(record).eq("id", id).eq("workspace_id", state.workspace.id);
    if (error) { console.warn("No se pudo actualizar la idea.", error); return showIdeaMessage("No se pudo guardar la idea. Comprueba la conexión e inténtalo otra vez."); }
    await log("details_updated", `actualizó la idea “${record.title}”`, null, id);
    state.modal = null;
    state.selectedIdea = null;
    await loadAll();
    render();
    toast("Idea actualizada.");
    return;
  }

  // La idea se muestra justo después de que Supabase confirme el insert.
  // No depende de una recarga posterior que pueda fallar por una tabla auxiliar.
  const createdIdea = { id: createUuid(), ...record, workspace_id: state.workspace.id, status: "idea", created_at: new Date().toISOString() };
  const { error } = await supabaseClient.from("content_ideas").insert({ ...createdIdea, created_by: state.session.user.id });
  if (error) {
    console.warn("No se pudo guardar la idea.", error);
    return showIdeaMessage("No se pudo guardar la idea. Comprueba la conexión e inténtalo otra vez.");
  }

  state.ideas = [createdIdea, ...state.ideas];
  state.modal = null;
  state.selectedIdea = null;
  render();
  toast("Idea guardada.");

  const { error: activityError } = await log("idea_created", `guardó una idea: ${record.title}`, null, createdIdea.id);
  if (activityError) console.warn("No se pudo registrar la actividad de la idea.", activityError);
  if (await loadAll({ preserveView: true })) render();
}
async function submitIdeaForm(form) {
  try {
    await saveIdea(new FormData(form));
  } catch (error) {
    console.error("Falló el guardado de la idea.", error);
    showIdeaMessage("No se pudo guardar la idea. Recarga la página e inténtalo otra vez.");
  }
}

async function saveVideo(form) { const channelId = form.get("channelId"); const record = { workspace_id: state.workspace.id, idea_id: form.get("ideaId") || null, channel_id: channelId, title: String(form.get("title")).trim(), scheduled_for: form.get("date"), format: String(form.get("format")).trim() || null, notes: String(form.get("notes")).trim(), current_stage: "idea", status: "pending", created_by: state.session.user.id, updated_by: state.session.user.id }; const { data, error } = await supabaseClient.from("video_entries").insert(record).select().single(); if (error) return toast("No se pudo programar el vídeo."); let promotionWarning = ""; if (record.idea_id) { const { data: promotedIdeas, error: promotionError } = await supabaseClient.from("content_ideas").update({ status: "scheduled" }).eq("id", record.idea_id).eq("workspace_id", state.workspace.id).select("id"); if (promotionError || !promotedIdeas?.length) promotionWarning = "El vídeo se programó, pero la idea no se pudo marcar como programada."; } await log("video_created", `programó “${record.title}”`, data.id, record.idea_id); state.modal = null; state.selectedVideo = null; await loadAll(); render(); toast(promotionWarning || `Programado. Ahora lo tiene ${ownerFor(data)}.`); }
async function setStage(id, targetStage) { const entry = state.entries.find((item) => item.id === id); if (!entry || entryStage(entry) === targetStage) return; const status = STAGE_TO_STATUS[targetStage]; const { error } = await supabaseClient.from("video_entries").update({ current_stage: targetStage, status, updated_by: state.session.user.id, completed_at: targetStage === "published" ? new Date().toISOString() : null }).eq("id", id).eq("workspace_id", state.workspace.id); if (error) return toast("No se pudo cambiar la fase."); const nextOwner = stage(entry.channel_id, targetStage)[2]; await log("stage_changed", `pasó “${entry.title}” a ${stage(entry.channel_id, targetStage)[1]} · ${nextOwner}`, id); await loadAll(); render(); toast(`Ahora lo tiene ${nextOwner}.`); }
async function saveDetails(form) { const id = form.get("id"); const entry = state.entries.find((item) => item.id === id); if (!entry) return toast("No encontramos ese vídeo."); const title = String(form.get("title")).trim(); const channelId = String(form.get("channelId")); const scheduledFor = String(form.get("date")); const rawResourceUrl = String(form.get("resourceUrl")).trim(); const resourceUrl = httpsUrl(rawResourceUrl); if (!title || title.length > 150 || !state.channels.some((item) => item.id === channelId) || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) return toast("Revisa título, canal y fecha."); if (rawResourceUrl && !resourceUrl) return toast("El enlace debe empezar por https://."); const channelChanged = channelId !== entry.channel_id; const resetWorkflow = channelChanged && !stageExists(channelId, entryStage(entry)); const { error } = await supabaseClient.rpc("update_video_details", { target_video_id: id, target_title: title, target_channel_id: channelId, target_scheduled_for: scheduledFor, target_notes: String(form.get("notes")).trim(), target_resource_url: resourceUrl || "", reset_workflow: resetWorkflow }); if (error) { console.warn("No se pudo corregir el vídeo.", error); return toast(/update_video_details|schema cache|function/i.test(error.message) ? "Falta ejecutar la actualización V3 de Supabase." : "No se pudo guardar el vídeo."); } await log("details_updated", `corrigió “${title}”${channelChanged ? ` · ${channel(channelId).name}` : ""}${resetWorkflow ? " · volvió a Idea" : ""}`, id); state.selectedDate = scheduledFor; await loadAll(); render(); toast(resetWorkflow ? "Vídeo corregido. La fase volvió a Idea." : "Vídeo actualizado."); }
async function submitDetailsForm(form) {
  const videoId = String(form.querySelector('[name="id"]')?.value || "");
  if (detailsSaveInFlight.has(videoId) || !form.reportValidity()) return;
  detailsSaveInFlight.add(videoId);
  const button = form.querySelector("[data-save-details]");
  if (button) {
    button.disabled = true;
    button.textContent = "Guardando…";
  }
  try {
    await saveDetails(new FormData(form));
  } catch (error) {
    console.error("Falló el guardado del vídeo.", error);
    toast("No se pudo guardar el vídeo. Recarga la página e inténtalo otra vez.");
  } finally {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "Guardar cambios";
    }
    detailsSaveInFlight.delete(videoId);
  }
}

async function deleteIdea(id) { const idea = state.ideas.find((item) => item.id === id); if (!idea) return; const linkedVideo = state.entries.find((item) => item.idea_id === id); const warning = linkedVideo ? `\n\nEl vídeo “${linkedVideo.title}” seguirá en el calendario, pero dejará de estar vinculado a esta idea.` : ""; if (!confirm(`¿Eliminar la idea “${idea.title}”?${warning}`)) return; const { error } = await supabaseClient.from("content_ideas").delete().eq("id", id).eq("workspace_id", state.workspace.id); if (error) { console.warn("No se pudo eliminar la idea.", error); return toast("No se pudo eliminar la idea."); } state.modal = null; state.selectedIdea = null; await loadAll(); render(); toast("Idea eliminada."); }
async function deleteVideo(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return toast("No encontramos ese vídeo. Cierra la ficha y vuelve a abrirlo.");
  if (!confirm(`¿Eliminar “${entry.title}”?`)) return;

  const { error: rpcError } = await supabaseClient.rpc("delete_video_and_restore_idea", { target_video_id: id });
  if (rpcError) {
    const migrationMissing = rpcError.code === "PGRST202" || /Could not find the function .*delete_video_and_restore_idea/i.test(rpcError.message);
    if (!migrationMissing) {
      console.warn("No se pudo eliminar el vídeo.", rpcError);
      return toast("No se pudo eliminar el vídeo. Comprueba tu conexión y prueba otra vez.");
    }

    // Compatibilidad con instalaciones que aún solo tienen V1 y V2.
    // V3 sigue siendo la ruta atómica; aquí conservamos el estado original por si falla el borrado.
    const linkedIdea = entry.idea_id ? state.ideas.find((item) => item.id === entry.idea_id) : null;
    const originalIdeaStatus = linkedIdea?.status;
    if (entry.idea_id && !originalIdeaStatus) return toast("No encontramos la idea vinculada. Recarga la página e inténtalo otra vez.");

    if (entry.idea_id && originalIdeaStatus !== "idea") {
      const { data: restoredIdeas, error: restoreError } = await supabaseClient
        .from("content_ideas")
        .update({ status: "idea" })
        .eq("id", entry.idea_id)
        .eq("workspace_id", state.workspace.id)
        .select("id");
      if (restoreError || !restoredIdeas?.length) {
        console.warn("No se pudo devolver la idea a la biblioteca.", restoreError);
        return toast("No se pudo preparar la idea para borrar el vídeo.");
      }
    }

    const { data: deletedVideos, error: deleteError } = await supabaseClient
      .from("video_entries")
      .delete()
      .eq("id", id)
      .eq("workspace_id", state.workspace.id)
      .select("id");
    if (deleteError || !deletedVideos?.length) {
      // Una respuesta de red puede llegar después de que el servidor haya borrado el vídeo.
      const refreshSucceeded = await loadAll();
      if (!refreshSucceeded) {
        render();
        console.warn("No se pudo confirmar el estado del vídeo tras el borrado.", deleteError);
        return toast("No pudimos confirmar si se eliminó el vídeo. Recarga la página antes de volver a intentarlo.");
      }
      if (state.entries.some((item) => item.id === id)) {
        let rollbackSucceeded = true;
        if (entry.idea_id && originalIdeaStatus !== "idea") {
          const { data: rolledBackIdeas, error: rollbackError } = await supabaseClient
            .from("content_ideas")
            .update({ status: originalIdeaStatus })
            .eq("id", entry.idea_id)
            .eq("workspace_id", state.workspace.id)
            .select("id");
          rollbackSucceeded = !rollbackError && Boolean(rolledBackIdeas?.length);
          if (!rollbackSucceeded) console.warn("No se pudo restaurar el estado original de la idea.", rollbackError);
        }
        await loadAll();
        render();
        console.warn("No se pudo eliminar el vídeo con la compatibilidad V2.", deleteError);
        return toast(rollbackSucceeded ? "No se pudo eliminar el vídeo. No se han aplicado cambios." : "No se pudo eliminar el vídeo y no se pudo restaurar la idea. Revisa la ficha antes de volver a intentarlo.");
      }
    }
  }

  const { error: activityError } = await log("video_deleted", `eliminó “${entry.title}”`, null, entry.idea_id);
  if (activityError) console.warn("No se pudo registrar la eliminación.", activityError);
  state.modal = null;
  state.selectedVideo = null;
  await loadAll();
  render();
  toast(entry.idea_id ? "Vídeo eliminado. La idea vuelve a estar disponible." : "Vídeo eliminado.");
}
function toast(message) { const node = document.querySelector("#toast"); if (!node) return; node.textContent = message; node.classList.add("show"); setTimeout(() => node.classList.remove("show"), 2600); }

document.addEventListener("click", async (event) => { const target = event.target.closest("[data-page],[data-action],[data-close-modal],[data-modal-backdrop],[data-open-video],[data-promote-idea],[data-edit-idea],[data-delete-idea],[data-next-stage],[data-set-stage],[data-video-id],[data-idea-filter],[data-filter-channel],[data-week],[data-day]"); if (!target || target.disabled) return; if (target.dataset.page) { state.page = target.dataset.page; render(); return; } if (target.dataset.action === "new-idea") { state.selectedIdea = null; state.modal = "idea"; render(); return; } if (target.dataset.action === "new-video") { state.selectedVideo = null; state.modal = "video"; render(); return; } if (target.dataset.action === "copy-code") { await navigator.clipboard.writeText(state.workspace.invite_code); toast("Código copiado."); return; } if (target.dataset.action === "logout") { await supabaseClient.auth.signOut(); return; } if (target.dataset.action === "delete-video") { await deleteVideo(target.dataset.videoId); return; } if (target.matches("[data-close-modal]") || (target.matches("[data-modal-backdrop]") && event.target === target)) { state.modal = null; state.selectedVideo = null; state.selectedIdea = null; render(); return; } if (target.dataset.openVideo) { state.selectedVideo = { id: target.dataset.openVideo }; state.modal = "detail"; render(); return; } if (target.dataset.promoteIdea) { const idea = state.ideas.find((item) => item.id === target.dataset.promoteIdea); state.selectedVideo = { idea }; state.modal = "video"; render(); return; } if (target.dataset.editIdea) { const idea = state.ideas.find((item) => item.id === target.dataset.editIdea); if (!idea) return; state.selectedIdea = idea; state.modal = "idea"; render(); return; } if (target.dataset.deleteIdea) { await deleteIdea(target.dataset.deleteIdea); return; } if (target.dataset.nextStage) { const entry = state.entries.find((item) => item.id === target.dataset.nextStage); const stages = workflow(entry.channel_id); const next = stages[stages.findIndex(([key]) => key === entryStage(entry)) + 1]; if (next) await setStage(entry.id, next[0]); return; } if (target.dataset.setStage) { await setStage(target.dataset.videoId, target.dataset.setStage); return; } if (target.dataset.ideaFilter) { state.ideaFilter = target.dataset.ideaFilter; render(); return; } if (target.dataset.filterChannel) { state.ideaFilter = target.dataset.filterChannel; state.page = "ideas"; render(); return; } if (target.dataset.week) { state.weekStart = addDays(state.weekStart, Number(target.dataset.week)); render(); return; } if (target.dataset.day) { state.selectedDate = addDays(state.selectedDate, Number(target.dataset.day)); render(); } });
document.addEventListener("change", (event) => { if (!event.target.matches("[data-date-input]")) return; state.selectedDate = event.target.value || iso(new Date()); render(); });
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === "login-form") return await login(new FormData(form).get("email"));
    if (form.id === "create-workspace") return await createWorkspace(new FormData(form).get("name"));
    if (form.id === "join-workspace") return await joinWorkspace(new FormData(form).get("code"));
    if (form.id === "idea-form") return await submitIdeaForm(form);
    if (form.id === "video-form") return await saveVideo(new FormData(form));
    if (form.id === "details-form") return await submitDetailsForm(form);
  } catch (error) {
    console.error("Falló el envío del formulario.", error);
    if (form.id === "idea-form") showIdeaMessage("No se pudo guardar la idea. Recarga la página e inténtalo otra vez.");
    else toast("No se pudo guardar el cambio. Recarga la página e inténtalo otra vez.");
  }
});
boot();
