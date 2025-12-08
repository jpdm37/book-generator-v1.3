import { v4 as uuidv4 } from "uuid";
import { query } from "./db.js";

function now() {
  return Date.now();
}

// Normalise inputs so we always have sane defaults and consistent shapes
function normalizeInputs(inputs = {}) {
  const n = { ...inputs };

  n.title = n.title || "";
  n.coreConcept = n.coreConcept || "";

  n.genre = n.genre || "General Fiction";
  n.subStyle = n.subStyle || "";
  n.tone = n.tone || "Balanced";
  n.voice = n.voice || "3rd Person Limited";

  n.targetAudience = n.targetAudience || "General Fiction";
  n.ageRange = n.ageRange || "18+";
  n.humourLevel = n.humourLevel || "Medium";

  // Chapter counts & word counts – keep the same names used in app.js
  {
    const v = Number(n.totalChapters);
    n.totalChapters = Number.isFinite(v) && v > 0 ? v : 12;
  }
  {
    const v = Number(n.chapterMinWords);
    n.chapterMinWords = Number.isFinite(v) && v > 0 ? v : 1500;
  }
  {
    const v = Number(n.chapterMaxWords);
    n.chapterMaxWords = Number.isFinite(v) && v > 0 ? v : 3000;
  }
  {
    const v = Number(n.chapterTargetWords);
    n.chapterTargetWords = Number.isFinite(v) && v > 0 ? v : 2000;
  }

  n.characters = n.characters || "";
  n.locations = n.locations || "";
  n.additionalNotes = n.additionalNotes || "";

  return n;
}

// Continuity / ledger default structure
function defaultLedger() {
  return {
    charactersState: {},
    locationsState: {},
    timeline: [],
    openLoops: []
  };
}

// --- JSON COERCION HELPERS (fix for JSONB write errors) ---

function asJsonObjectOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") return parsed;
      // If it's just arbitrary text, box it
      return { raw: value };
    } catch {
      return { raw: value };
    }
  }
  // Anything else: box it as a simple object
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

// --- Project listing / fetching ---

export async function listProjects() {
  const res = await query(
    `SELECT id, inputs, chapters, updated_at 
     FROM projects 
     ORDER BY updated_at DESC 
     LIMIT 200`,
    []
  );

  return res.rows.map((r) => {
    const inputs = normalizeInputs(r.inputs || {});
    const chapters = Array.isArray(r.chapters) ? r.chapters : [];
    const totalChapters =
      Number.isFinite(Number(inputs.totalChapters)) && Number(inputs.totalChapters) > 0
        ? Number(inputs.totalChapters)
        : chapters.length;

    return {
      id: r.id,
      title: inputs.title || "Untitled Project",
      totalChapters,
      updatedAt: Number(r.updated_at),
      inputs
    };
  });
}

export async function getProject(id) {
  const res = await query(
    `SELECT id,
            created_at,
            updated_at,
            inputs,
            brief,
            bible,
            outline,
            chapter_contracts,
            chapters,
            continuity_ledger
     FROM projects
     WHERE id = $1`,
    [id]
  );

  if (res.rows.length === 0) {
    return null;
  }

  const r = res.rows[0];

  const inputs = normalizeInputs(r.inputs || {});
  const chapterContracts = asJsonArray(r.chapter_contracts);
  const chapters = asJsonArray(r.chapters);
  const ledger =
    r.continuity_ledger ||
    rebuildLedgerFromChapters(chapters);

  return {
    id: r.id,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    inputs,
    brief: r.brief,
    bible: r.bible,
    outline: r.outline,
    chapterContracts,
    chapters,
    continuityLedger: ledger
  };
}

// --- Core save logic (this is where your JSONB error was happening) ---

async function saveProject(project) {
  const updatedAt = now();

  const inputs = normalizeInputs(project.inputs || {});
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

// --- Creation / deletion ---

export async function createProject() {
  const id = uuidv4();
  const createdAt = now();

  const inputs = normalizeInputs({});
  const brief = null;
  const bible = null;
  const outline = null;
  const chapterContracts = [];
  const chapters = [];
  const continuityLedger = defaultLedger();

  await query(
    `INSERT INTO projects (
       id,
       created_at,
       updated_at,
       inputs,
       brief,
       bible,
       outline,
       chapter_contracts,
       chapters,
       continuity_ledger
     )
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      createdAt,
      inputs,
      brief,
      bible,
      outline,
      chapterContracts,
      chapters,
      continuityLedger
    ]
  );

  return getProject(id);
}

export async function deleteProject(id) {
  await query(`DELETE FROM projects WHERE id = $1`, [id]);
}

// --- Continuity helpers ---

function mergeLedger(base, patch) {
  if (!patch || typeof patch !== "object") return base;

  base.charactersState = {
    ...(base.charactersState || {}),
    ...(patch.charactersState || {})
  };

  base.locationsState = {
    ...(base.locationsState || {}),
    ...(patch.locationsState || {})
  };

  if (Array.isArray(patch.timeline)) {
    base.timeline = [...(base.timeline || []), ...patch.timeline];
  }

  if (Array.isArray(patch.openLoops)) {
    base.openLoops = [...(base.openLoops || []), ...patch.openLoops];
  }

  return base;
}

export function rebuildLedgerFromChapters(
  chapters = [],
  stopBeforeIndex = Infinity
) {
  const ledger = defaultLedger();
  const ordered = [...chapters].sort((a, b) => {
    const ai = typeof a.index === "number" ? a.index : 0;
    const bi = typeof b.index === "number" ? b.index : 0;
    return ai - bi;
  });

  for (const c of ordered) {
    if (typeof c.index === "number" && c.index >= stopBeforeIndex) break;
    if (c.continuity) mergeLedger(ledger, c.continuity);
  }

  return ledger;
}

/**
 * Clear all chapters and chapter contracts from a given chapter index onwards,
 * then rebuild the continuity ledger from the remaining earlier chapters.
 * This is what server.js expects for the "rewind from chapter" endpoint.
 */
export async function clearAndRewindFromChapter(projectId, chapterIndex) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const safeChapters = asJsonArray(project.chapters);
  const safeContracts = asJsonArray(project.chapterContracts);

  const keptChapters = safeChapters.filter((c) => {
    if (typeof c.index !== "number") return true;
    return c.index < chapterIndex;
  });

  const keptContracts = safeContracts.filter((c) => {
    if (typeof c.index !== "number") return true;
    return c.index < chapterIndex;
  });

  const newLedger = rebuildLedgerFromChapters(keptChapters);

  const updated = {
    ...project,
    chapters: keptChapters,
    chapterContracts: keptContracts,
    continuityLedger: newLedger
  };

  return saveProject(updated);
}

// For engine/server code that might already be calling this
export async function _saveProjectDirect(project) {
  return saveProject(project);
}

// Also export saveProject explicitly if server.js imports it by name
export { saveProject };
