import { v4 as uuidv4 } from "uuid";
import { query } from "./db.js";

function now() {
  return Date.now();
}

function normalizeInputs(inputs = {}) {
  const n = { ...inputs };

  n.title = n.title || "";
  n.coreConcept = n.coreConcept || "";
  n.genre = n.genre || "General Fiction";
  n.subStyle = n.subStyle || "";
  n.tone = n.tone || "Balanced";
  n.voice = n.voice || "3rd Person Limited";
  n.humourLevel = n.humourLevel || "Medium";
  n.targetAudience = n.targetAudience || "General Fiction";
  n.ageRange = n.ageRange || "18+";

  n.totalChapters = Number(n.totalChapters || 12);
  n.chapterTargetWords = Number(n.chapterTargetWords || 2000);
  n.chapterMinWords = Number(n.chapterMinWords || 1500);
  n.chapterMaxWords = Number(n.chapterMaxWords || 3000);

  n.characters = n.characters || "";
  n.locations = n.locations || "";
  n.additionalNotes = n.additionalNotes || "";

  return n;
}

function defaultLedger() {
  return {
    charactersState: {},
    locationsState: {},
    timeline: [],
    openLoops: []
  };
}

function asJsonObjectOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
      return { raw: value };
    } catch {
      return { raw: value };
    }
  }
  return { raw: String(value) };
}

function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
      return [{ raw: value }];
    } catch {
      return [{ raw: value }];
    }
  }
  if (typeof value === "object") {
    return [value];
  }
  return [{ raw: String(value) }];
}

export async function listProjects() {
  const res = await query(
    `SELECT id, inputs, updated_at FROM projects ORDER BY updated_at DESC LIMIT 200`,
    []
  );

  return res.rows.map(r => ({
    id: r.id,
    title: r.inputs?.title || "Untitled Project",
    genre: r.inputs?.genre,
    updatedAt: Number(r.updated_at)
  }));
}

export async function getProject(id) {
  const res = await query(`SELECT * FROM projects WHERE id = $1`, [id]);
  if (!res.rows.length) return null;
  const r = res.rows[0];

  const chapterContracts = Array.isArray(r.chapter_contracts) ? r.chapter_contracts : [];
  const chapters = Array.isArray(r.chapters) ? r.chapters : [];
  const ledger =
    (r.continuity_ledger && typeof r.continuity_ledger === "object")
      ? r.continuity_ledger
      : defaultLedger();

  return {
    id: r.id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    inputs: r.inputs || {},
    brief: r.brief,
    bible: r.bible,
    outline: r.outline,
    chapterContracts,
    chapters,
    continuityLedger: ledger
  };
}

async function saveProject(project) {
  const updatedAt = now();

  const inputs = project.inputs || {};
  const brief = asJsonObjectOrNull(project.brief);
  const bible = asJsonObjectOrNull(project.bible);
  const outline = asJsonObjectOrNull(project.outline);
  const chapterContracts = asJsonArray(project.chapterContracts);
  const chapters = asJsonArray(project.chapters);
  const continuityLedger = project.continuityLedger || defaultLedger();

  await query(
    `UPDATE projects
     SET updated_at = $2,
         inputs = $3,
         brief = $4,
         bible = $5,
         outline = $6,
         chapter_contracts = $7,
         chapters = $8,
         continuity_ledger = $9
     WHERE id = $1`,
    [
      project.id,
      updatedAt,
      inputs,
      brief,
      bible,
      outline,
      chapterContracts,
      chapters,
      continuityLedger
    ]
  );

  return getProject(project.id);
}

export async function createProject(initial = {}) {
  const id = uuidv4();
  const createdAt = now();
  const inputs = normalizeInputs(initial);

  const project = {
    id,
    createdAt,
    updatedAt: createdAt,
    inputs,
    brief: null,
    bible: null,
    outline: null,
    chapterContracts: [],
    chapters: [],
    continuityLedger: defaultLedger()
  };

  await query(
    `INSERT INTO projects (id, created_at, updated_at, inputs, chapter_contracts, chapters, continuity_ledger)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      project.id,
      project.createdAt,
      project.updatedAt,
      project.inputs,
      project.chapterContracts,
      project.chapters,
      project.continuityLedger
    ]
  );

  return getProject(id);
}

export async function updateProjectInputs(id, patch = {}) {
  const project = await getProject(id);
  if (!project) throw new Error("Project not found");

  project.inputs = normalizeInputs({ ...project.inputs, ...patch });

  return saveProject(project);
}

export async function deleteProject(id) {
  await query(`DELETE FROM projects WHERE id = $1`, [id]);
}

export async function saveUserEdits(id, chapterIndex, { text, continuityOverride } = {}) {
  const project = await getProject(id);
  if (!project) throw new Error("Project not found");

  const ch = (project.chapters || []).find(c => c.index === chapterIndex);
  if (!ch) throw new Error("Chapter not found");

  if (typeof text === "string") ch.userText = text;

  if (continuityOverride && typeof continuityOverride === "object") {
    ch.continuity = { ...(ch.continuity || {}), ...continuityOverride, source: "user" };
  }

  ch.approved = Boolean(ch.userText && ch.userText.trim().length > 50);

  return saveProject(project);
}

export async function clearAndRewindFromChapter(id, chapterIndex) {
  const project = await getProject(id);
  if (!project) throw new Error("Project not found");

  project.chapters = (project.chapters || []).map(c => {
    if (c.index >= chapterIndex) {
      return {
        ...c,
        draftText: "",
        userText: "",
        continuity: null,
        approved: false
      };
    }
    return c;
  });

  project.continuityLedger = rebuildLedgerFromChapters(project.chapters, chapterIndex);

  return saveProject(project);
}

function mergeLedger(ledger, continuity) {
  if (!continuity) return ledger;

  if (continuity.charactersState && typeof continuity.charactersState === "object") {
    ledger.charactersState = { ...ledger.charactersState, ...continuity.charactersState };
  }
  if (continuity.locationsState && typeof continuity.locationsState === "object") {
    ledger.locationsState = { ...ledger.locationsState, ...continuity.locationsState };
  }
  if (Array.isArray(continuity.timelineEvents)) {
    ledger.timeline.push(...continuity.timelineEvents);
  }
  if (Array.isArray(continuity.openLoops)) {
    const set = new Set([...(ledger.openLoops || []), ...continuity.openLoops]);
    ledger.openLoops = Array.from(set);
  }

  return ledger;
}

export function rebuildLedgerFromChapters(chapters = [], stopBeforeIndex = Infinity) {
  const ledger = defaultLedger();
  const ordered = [...chapters].sort((a, b) => a.index - b.index);

  for (const c of ordered) {
    if (c.index >= stopBeforeIndex) break;
    if (c.continuity) mergeLedger(ledger, c.continuity);
  }
  return ledger;
}

export async function _saveProjectDirect(project) {
  return saveProject(project);
}
