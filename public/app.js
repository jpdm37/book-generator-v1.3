
const $ = (id) => document.getElementById(id);

const state = {
  projects: [],
  projectId: null,
  project: null,
  currentStep: 1,
  maxStepUnlocked: 1,
  currentChapterIndex: null
};

const GENRES = [
  "General Fiction","Literary Fiction","Epic Fantasy","Urban Fantasy","Hard Sci-Fi",
  "Space Opera","Cozy Mystery","Noir Detective","Satirical Thriller","Romantic Comedy",
  "Historical Fiction","Dystopian","Cyberpunk","Horror","Gothic Horror",
  "Psychological Thriller","Middle Grade Adventure","Young Adult Drama",
  "Academic Nonfiction","Popular Science","Business & Strategy","Self-Help"
];

const SUB_STYLES = ["","Noir","Gothic","Slice-of-Life","Found Footage","Mythic","Minimalist","Maximalist","Experimental","Episodic","Cinematic","Epistolary"];
const TONES = ["Balanced","Optimistic","Cynical","Solemn","Wistful","Urgent","Playful","Romantic","Bleak","Hopepunk"];
const VOICES = ["3rd Person Limited","1st Person / Intimate","1st Person / Snarky","3rd Person Omniscient / Formal","2nd Person / Experimental"];
const AUDIENCES = ["General Fiction","Young Adult (YA)","Middle Grade","Academic","Business Readers","Popular Nonfiction"];
const AGE_RANGES = ["8-12","12-16","16-18","18+","All ages (clean)"];
const HUMOUR_LEVELS = ["Very High","High","Medium","Low","None"];

function fillSelect(el, values) {
  if (!el) return;
  el.innerHTML = "";
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v || "—";
    el.appendChild(opt);
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return res;
}

function setGlobalStatus(msg) {
  const el = $("globalStatus");
  if (el) el.textContent = msg;
}

async function guard(fn, label = "Working...") {
  const buttons = document.querySelectorAll("button");
  buttons.forEach(b => (b.disabled = true));
  setGlobalStatus(label);
  try {
    await fn();
    setGlobalStatus("Ready.");
  } catch (err) {
    alert(err.message);
    setGlobalStatus(`Error: ${err.message}`);
  } finally {
    buttons.forEach(b => (b.disabled = false));
  }
}

/* ------------ State helpers ------------ */

function ensureProjectLoaded() {
  if (!state.projectId || !state.project) {
    throw new Error("Create or load a project first.");
  }
}

function computeDraftProgress() {
  const total = Number(state.project?.inputs?.totalChapters || 0);
  const chapters = Array.isArray(state.project?.chapters) ? state.project.chapters : [];
  const drafted = chapters.filter(c => c && c.draftText && String(c.draftText).trim().length > 0).length;
  return { total: total || chapters.length || 0, drafted };
}

function updateProgress() {
  const { total, drafted } = computeDraftProgress();
  const label = $("progressLabel");
  const fill = $("progressFill");
  if (label) label.textContent = `${drafted} of ${total} chapters drafted`;
  const pct = total > 0 ? Math.min(100, Math.round((drafted / total) * 100)) : 0;
  if (fill) fill.style.width = pct + "%";
}

function updateProjectMeta() {
  const el = $("projectMeta");
  if (!el) return;
  if (!state.project) {
    el.textContent = "No project loaded.";
    return;
  }
  const p = state.project;
  const updated = p.updatedAt ? new Date(Number(p.updatedAt)).toLocaleString() : "—";
  const title = p.inputs?.title || "Untitled Project";
  const genre = p.inputs?.genre || "—";
  el.textContent = `${title} • ${genre} • Updated ${updated}`;
}

/* ------------ Projects list & selection ------------ */

async function fetchProjects() {
  const res = await api("/api/projects");
  state.projects = await res.json();
  renderProjectSelect();
}

function renderProjectSelect() {
  const sel = $("projectSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.projects.length ? "Select a project..." : "No projects yet";
  sel.appendChild(placeholder);
  state.projects.forEach(p => {
    const opt = document.createElement("option");
    const title = p.title || p.inputs?.title || "Untitled Project";
    const updated = p.updatedAt ? new Date(Number(p.updatedAt)).toLocaleString() : "";
    opt.value = p.id;
    opt.textContent = `${title} (${updated})`;
    sel.appendChild(opt);
  });
}

async function createProject() {
  const payload = {
    title: "Untitled Project",
    coreConcept: "",
    genre: "General Fiction"
  };
  const res = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const project = await res.json();
  state.projectId = project.id;
  state.project = project;
  state.currentStep = 1;
  state.maxStepUnlocked = Math.max(state.maxStepUnlocked, 1);
  await fetchProjects();
  await loadProject(project.id);
  unlockStep(2);
  goToStep(2);
}

async function loadProject(id) {
  const res = await api(`/api/projects/${id}`);
  state.project = await res.json();
  state.projectId = state.project.id;
  state.maxStepUnlocked = 5; // when loading an existing project allow full navigation
  writeInputsToUI();
  renderInputsPreview();
  renderBrief();
  renderBible();
  renderOutline();
  renderChapters();
  updateProjectMeta();
  updateProgress();
  updateStepper();
}

/* ------------ Inputs step ------------ */

function readInputsFromUI() {
  return {
    title: $("title")?.value || "",
    coreConcept: $("coreConcept")?.value || "",
    genre: $("genre")?.value || "General Fiction",
    subStyle: $("subStyle")?.value || "",
    tone: $("tone")?.value || "Balanced",
    voice: $("voice")?.value || "3rd Person Limited",
    targetAudience: $("targetAudience")?.value || "General Fiction",
    ageRange: $("ageRange")?.value || "18+",
    humourLevel: $("humourLevel")?.value || "Medium",
    totalChapters: Number($("totalChapters")?.value || 12),
    chapterTargetWords: Number($("chapterTargetWords")?.value || 2000),
    chapterMinWords: Number($("chapterMinWords")?.value || 1500),
    chapterMaxWords: Number($("chapterMaxWords")?.value || 3000),
    characters: $("characters")?.value || "",
    locations: $("locations")?.value || "",
    additionalNotes: $("additionalNotes")?.value || ""
  };
}

function writeInputsToUI() {
  const i = state.project?.inputs || {};
  const setVal = (id, def = "") => {
    const el = $(id);
    if (el) el.value = i[id] ?? def;
  };
  setVal("title");
  setVal("coreConcept");
  if ($("genre")) $("genre").value = i.genre || "General Fiction";
  if ($("subStyle")) $("subStyle").value = i.subStyle || "";
  if ($("tone")) $("tone").value = i.tone || "Balanced";
  if ($("voice")) $("voice").value = i.voice || "3rd Person Limited";
  if ($("targetAudience")) $("targetAudience").value = i.targetAudience || "General Fiction";
  if ($("ageRange")) $("ageRange").value = i.ageRange || "18+";
  if ($("humourLevel")) $("humourLevel").value = i.humourLevel || "Medium";
  if ($("totalChapters")) $("totalChapters").value = i.totalChapters || 12;
  if ($("chapterTargetWords")) $("chapterTargetWords").value = i.chapterTargetWords || 2000;
  if ($("chapterMinWords")) $("chapterMinWords").value = i.chapterMinWords || 1500;
  if ($("chapterMaxWords")) $("chapterMaxWords").value = i.chapterMaxWords || 3000;
  if ($("chapterMaxWords")) $("chapterMaxWords").value = i.chapterMaxWords || 3000;
  if ($("characters")) $("characters").value = i.characters || "";
  if ($("locations")) $("locations").value = i.locations || "";
  if ($("additionalNotes")) $("additionalNotes").value = i.additionalNotes || "";
}

function renderInputsPreview() {
  const el = $("inputsPreview");
  if (!el) return;
  const i = state.project?.inputs || readInputsFromUI();
  const summary = {
    title: i.title || "(no title)",
    genre: i.genre,
    subStyle: i.subStyle,
    tone: i.tone,
    voice: i.voice,
    targetAudience: i.targetAudience,
    ageRange: i.ageRange,
    humourLevel: i.humourLevel,
    chapters: {
      totalChapters: i.totalChapters,
      targetWords: i.chapterTargetWords,
      minWords: i.chapterMinWords,
      maxWords: i.chapterMaxWords
    },
    coreConcept: i.coreConcept,
    characters: i.characters,
    locations: i.locations,
    additionalNotes: i.additionalNotes
  };
  el.textContent = JSON.stringify(summary, null, 2);
}

async function saveInputs() {
  ensureProjectLoaded();
  const payload = readInputsFromUI();
  const res = await api(`/api/projects/${state.projectId}/inputs`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  state.project = await res.json();
  renderInputsPreview();
  updateProjectMeta();
  updateProgress();
  await fetchProjects();
}

/* ------------ Brief & Bible ------------ */

function extractTextFromStructure(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.text) return obj.text;
  // flatten relevant keys if present
  const candidateKeys = ["overview", "summary", "hook", "themes", "structure", "canon", "rules"];
  const parts = [];
  for (const key of candidateKeys) {
    if (obj[key]) {
      parts.push(`${key.toUpperCase()}:\n${obj[key]}`);
    }
  }
  if (parts.length) return parts.join("\n\n");
  return JSON.stringify(obj, null, 2);
}

function renderBrief() {
  const el = $("briefDisplay");
  if (!el) return;
  const brief = state.project?.brief;
  if (!brief) {
    el.textContent = "";
    return;
  }
  el.textContent = extractTextFromStructure(brief);
}

function renderBible() {
  const el = $("bibleDisplay");
  if (!el) return;
  const bible = state.project?.bible;
  if (!bible) {
    el.textContent = "";
    return;
  }
  el.textContent = extractTextFromStructure(bible);
}

async function generateBriefBible() {
  ensureProjectLoaded();
  await saveInputs();
  const status = $("briefBibleStatus");
  if (status) status.textContent = "Generating...";
  const res = await api(`/api/projects/${state.projectId}/brief-bible`, { method: "POST" });
  state.project = await res.json();
  renderBrief();
  renderBible();
  updateProjectMeta();
  updateProgress();
  await fetchProjects();
  if (status) status.textContent = "Done.";
  unlockStep(3);
}

/* ------------ Outline ------------ */

function renderOutline() {
  const el = $("outlineDisplay");
  if (!el) return;
  const outline = state.project?.outline;
  if (!outline) {
    el.textContent = "";
    return;
  }
  if (typeof outline === "string") {
    el.textContent = outline;
  } else {
    el.textContent = JSON.stringify(outline, null, 2);
  }
}

async function generateOutline() {
  ensureProjectLoaded();
  const status = $("outlineStatus");
  if (status) status.textContent = "Generating outline...";
  const res = await api(`/api/projects/${state.projectId}/outline`, { method: "POST" });
  state.project = await res.json();
  renderOutline();
  updateProjectMeta();
  updateProgress();
  await fetchProjects();
  if (status) status.textContent = "Done.";
  unlockStep(4);
}

/* ------------ Chapters ------------ */

function getChaptersSorted() {
  const arr = Array.isArray(state.project?.chapters) ? state.project.chapters : [];
  return [...arr].sort((a, b) => a.index - b.index);
}

function renderChapters() {
  const list = $("chaptersList");
  if (!list) return;
  list.innerHTML = "";
  const chapters = getChaptersSorted();
  if (!chapters.length) {
    const li = document.createElement("li");
    li.className = "small muted";
    li.textContent = "No chapters yet. Generate the first one.";
    list.appendChild(li);
  } else {
    chapters.forEach(ch => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "secondary";
      const status = ch.approved ? "✅" : (ch.draftText ? "📝" : "⏳");
      btn.textContent = `${status} Chapter ${ch.index}: ${ch.title || ""}`;
      btn.addEventListener("click", () => {
        state.currentChapterIndex = ch.index;
        loadChapter(ch.index);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  const firstDrafted = chapters.find(c => c.draftText);
  if (firstDrafted && state.currentChapterIndex == null) {
    state.currentChapterIndex = firstDrafted.index;
    loadChapter(firstDrafted.index);
  }

  const nextBtn = $("generateNextChapterBtn");
  const firstBtn = $("generateFirstChapterBtn");
  if (chapters.length === 0) {
    if (firstBtn) firstBtn.classList.remove("hidden");
    if (nextBtn) nextBtn.classList.add("hidden");
  } else {
    if (firstBtn) firstBtn.classList.add("hidden");
    if (nextBtn) nextBtn.classList.remove("hidden");
  }

  updateProgress();
}

function loadChapter(index) {
  const chapters = getChaptersSorted();
  const ch = chapters.find(c => c.index === Number(index));
  const label = $("currentChapterLabel");
  const draftEl = $("draftText");
  const userEl = $("userText");
  const contEl = $("continuityDisplay");

  if (!ch) {
    if (label) label.textContent = "No chapter selected.";
    if (draftEl) draftEl.value = "";
    if (userEl) userEl.value = "";
    if (contEl) contEl.textContent = "";
    return;
  }

  if (label) label.textContent = `Chapter ${ch.index}: ${ch.title || ""} ${ch.approved ? "(approved)" : ""}`;
  if (draftEl) draftEl.value = ch.draftText || "";
  if (userEl) userEl.value = ch.userText || "";
  if (contEl) {
    contEl.textContent = ch.continuity ? JSON.stringify(ch.continuity, null, 2) : "";
  }
}

async function generateNextChapter() {
  ensureProjectLoaded();
  const status = $("chaptersStatus");
  if (status) status.textContent = "Generating chapter...";
  const res = await api(`/api/projects/${state.projectId}/chapters/next`, { method: "POST" });
  state.project = await res.json();
  renderChapters();
  updateProjectMeta();
  await fetchProjects();
  if (status) status.textContent = "Done.";
}

async function generateFirstChapter() {
  await generateNextChapter();
  unlockStep(5);
}

async function saveChapterEdits() {
  ensureProjectLoaded();
  const idx = state.currentChapterIndex;
  if (!idx) throw new Error("Select a chapter first.");
  const text = $("userText")?.value || "";
  const res = await api(`/api/projects/${state.projectId}/chapters/${idx}/edits`, {
    method: "PUT",
    body: JSON.stringify({ text })
  });
  state.project = await res.json();
  renderChapters();
  loadChapter(idx);
  await fetchProjects();
}

async function regenerateChapter() {
  ensureProjectLoaded();
  const idx = state.currentChapterIndex;
  if (!idx) throw new Error("Select a chapter first.");
  const ok = confirm("Regenerate this chapter? Later chapters will be rewound.");
  if (!ok) return;
  const res = await api(`/api/projects/${state.projectId}/chapters/${idx}/regenerate`, {
    method: "POST"
  });
  state.project = await res.json();
  renderChapters();
  loadChapter(idx);
  await fetchProjects();
}

/* ------------ Downloads ------------ */

function downloadDocx() {
  if (!state.projectId) return;
  window.location.href = `/api/projects/${state.projectId}/download/docx`;
}
function downloadMd() {
  if (!state.projectId) return;
  window.location.href = `/api/projects/${state.projectId}/download/markdown`;
}

/* ------------ Stepper logic ------------ */

function unlockStep(step) {
  state.maxStepUnlocked = Math.max(state.maxStepUnlocked, step);
  updateStepper();
}

function goToStep(step) {
  state.currentStep = step;
  updatePanels();
  updateStepper();
}

function updatePanels() {
  const panels = document.querySelectorAll("[data-step-panel]");
  panels.forEach(p => {
    const step = Number(p.getAttribute("data-step-panel"));
    p.classList.toggle("hidden", step !== state.currentStep);
  });
}

function updateStepper() {
  const items = document.querySelectorAll(".stepper .step");
  items.forEach(li => {
    const step = Number(li.getAttribute("data-step"));
    const btn = li.querySelector(".step-btn");
    if (btn) {
      btn.disabled = step > state.maxStepUnlocked;
    }
    li.classList.toggle("active", step === state.currentStep);
    li.classList.toggle("complete", step < state.currentStep && step <= state.maxStepUnlocked);
  });

  // Enable/disable Next buttons based on project state
  const nextFromProject = $("nextFromProjectBtn");
  const nextFromInputs = $("nextFromInputsBtn");
  const nextFromBrief = $("nextFromBriefBtn");
  const nextFromOutline = $("nextFromOutlineBtn");

  if (nextFromProject) nextFromProject.disabled = !state.projectId;

  const inputs = state.project?.inputs || {};
  const hasInputs = !!(inputs && (inputs.title || inputs.coreConcept || inputs.characters || inputs.locations));
  if (nextFromInputs) nextFromInputs.disabled = !hasInputs;

  const hasBriefBible = !!(state.project?.brief && state.project?.bible);
  if (nextFromBrief) nextFromBrief.disabled = !hasBriefBible;

  const hasOutline = !!state.project?.outline;
  if (nextFromOutline) nextFromOutline.disabled = !hasOutline;
}

/* ------------ Wiring ------------ */

function wireEvents() {
  // Project create/load
  $("createProjectBtn")?.addEventListener("click", () => guard(createProject, "Creating project..."));
  $("loadProjectBtn")?.addEventListener("click", () =>
    guard(async () => {
      const id = $("projectSelect")?.value;
      if (!id) throw new Error("Select a project in the dropdown.");
      await loadProject(id);
    }, "Loading project...")
  );

  // Stepper buttons
  for (let i = 1; i <= 5; i++) {
    const btn = $(`stepBtn${i}`);
    if (btn) {
      btn.addEventListener("click", () => {
        if (i <= state.maxStepUnlocked) {
          goToStep(i);
        }
      });
    }
  }

  // Next/back buttons
  $("nextFromProjectBtn")?.addEventListener("click", () => {
    if (!state.projectId) {
      alert("Create or load a project first.");
      return;
    }
    unlockStep(2);
    goToStep(2);
  });

  $("backToProjectBtn")?.addEventListener("click", () => goToStep(1));

  $("nextFromInputsBtn")?.addEventListener("click", () => {
    unlockStep(3);
    goToStep(3);
  });

  $("backToInputsBtn")?.addEventListener("click", () => goToStep(2));

  $("nextFromBriefBtn")?.addEventListener("click", () => {
    unlockStep(4);
    goToStep(4);
  });

  $("backToBriefBtn")?.addEventListener("click", () => goToStep(3));

  $("nextFromOutlineBtn")?.addEventListener("click", () => {
    unlockStep(5);
    goToStep(5);
  });

  $("backToOutlineBtn")?.addEventListener("click", () => goToStep(4));

  // Inputs actions
  $("saveInputsBtn")?.addEventListener("click", () => guard(saveInputs, "Saving inputs..."));
  $("previewInputsBtn")?.addEventListener("click", () => renderInputsPreview());

  // Brief/Bible
  $("generateBriefBibleBtn")?.addEventListener("click", () => guard(generateBriefBible, "Generating brief & bible..."));

  // Outline
  $("generateOutlineBtn")?.addEventListener("click", () => guard(generateOutline, "Generating outline..."));

  // Chapters
  $("generateFirstChapterBtn")?.addEventListener("click", () => guard(generateFirstChapter, "Generating first chapter..."));
  $("generateNextChapterBtn")?.addEventListener("click", () => guard(generateNextChapter, "Generating next chapter..."));
  $("approveChapterBtn")?.addEventListener("click", () => guard(saveChapterEdits, "Saving chapter edits..."));
  $("regenerateChapterBtn")?.addEventListener("click", () => guard(regenerateChapter, "Regenerating chapter..."));

  // Downloads
  $("downloadDocxBtn")?.addEventListener("click", downloadDocx);
  $("downloadMdBtn")?.addEventListener("click", downloadMd);
}

function init() {
  fillSelect($("genre"), GENRES);
  fillSelect($("subStyle"), SUB_STYLES);
  fillSelect($("tone"), TONES);
  fillSelect($("voice"), VOICES);
  fillSelect($("targetAudience"), AUDIENCES);
  fillSelect($("ageRange"), AGE_RANGES);
  fillSelect($("humourLevel"), HUMOUR_LEVELS);

  wireEvents();
  updatePanels();
  updateStepper();
  fetchProjects().catch(() => {});
}

init();
