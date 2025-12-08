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

  n.targetAudience = n.targetAudience || "General Fiction";
  n.ageRange = n.ageRange || "18+";
  n.humourLevel = n.humourLevel || "Medium";

  const total = parseInt(n.totalChapters, 10);
  n.totalChapters = Number.isFinite(total) && total > 0 ? total : 12;

  const min = parseInt(n.chapterMinWords, 10);
  n.chapterMinWords = Number.isFinite(min) && min > 0 ? min : 1500;

  const max = parseInt(n.chapterMaxWords, 10);
  n.chapterMaxWords = Number.isFinite(max) && max > 0 ? max : 3000;

  const target = parseInt(n.chapterTargetWords, 10);
  n.chapterTargetWords = Number.isFinite(target) && target > 0 ? target : 2000;

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

// ---------- JSON helpers ----------

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

// ---------- Listing & fetching ----------

export async function listProjects() {
  const res = await query(
    `SELECT id, inputs, chapters, updated_at
     FROM projects
     ORDER BY updated_at DESC
     LIMIT 200`,
    []
  );

  return res.rows.map((row) => {
    const inputs = normalizeInputs(row.inputs || {});
    const chapters = Array.isArray(row.chapters) ? row.chapters : [];
    const totalChapters =
      Number.isFinite(Number(inputs.totalChapters)) && Number(inputs.totalChapters) > 0
        ? Number(inputs.totalChapters)
        : chapters.length;

    return {
      id: row.id,
      title: inputs.title || "Untitled Project",
      totalChapters,
      updatedAt: Number(row.updated_at),
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

  const row = res.rows[0];
  const inputs = normalizeInputs(row.inputs || {});
  const chapterContracts = Array.isArray(row.chapter_contracts)
    ? row.chapter_contracts
    : asJsonArray(row.chapter_contracts);
  const chapters = Array.isArray(row.chapters)
    ? row.chapters
    : asJsonArray(row.chapters);

  const ledger =
    row.continuity_ledger || rebuildLedgerFromChapters(chapters);

  return {
    id: row.id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    inputs,
    brief: row.brief,
    bible: row.bible,
    outline: row.outline,
    chapterContracts,
    chapters,
    continuityLedger: ledger
  };
}

// ---------- Core save logic (JSONB-safe) ----------

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
         inputs = $3::jsonb,
         brief = $4::jsonb,
         bible = $5::jsonb,
         outline = $6::jsonb,
         chapter_contracts = $7::jsonb,
         chapters = $8::jsonb,
         continuity_ledger = $9::jsonb
     WHERE id = $1`,
    [
      project.id,
      updatedAt,
      JSON.stringify(inputs),
      brief === null ? null : JSON.stringify(brief),
      bible === null ? null : JSON.stringify(bible),
      outline === null ? null : JSON.stringify(outline),
      JSON.stringify(chapterContracts),
      JSON.stringify(chapters),
      JSON.stringify(continuityLedger)
    ]
  );

  return getProject(project.id);
}

// ---------- Creation / inputs / deletion ----------

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
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)`,
    [
      project.id,
      project.createdAt,
      project.updatedAt,
      JSON.stringify(project.inputs),
      JSON.stringify(project.chapterContracts),
      JSON.stringify(project.chapters),
      JSON.stringify(project.continuityLedger)
    ]
  );

  return getProject(id);
}

export async function updateProjectInputs(id, patch = {}) {
  const res = await query(
    `SELECT inputs FROM projects WHERE id = $1`,
    [id]
  );

  if (res.rows.length === 0) {
    throw new Error("Project not found");
  }

  const current = res.rows[0].inputs || {};
  const updated = normalizeInputs({ ...current, ...patch });

  await query(
    `UPDATE projects
     SET inputs = $2
     WHERE id = $1`,
    [id, updated]
  );
}

export async function deleteProject(id) {
  await query(`DELETE FROM projects WHERE id = $1`, [id]);
}

// ---------- User edits & continuity ----------

export async function saveUserEdits(id, payload = {}) {
  const res = await query(
    `SELECT chapter_contracts, chapters
     FROM projects
     WHERE id = $1`,
    [id]
  );

  if (res.rows.length === 0) {
    throw new Error("Project not found");
  }

  const row = res.rows[0];
  const chapterContracts = Array.isArray(row.chapter_contracts)
    ? row.chapter_contracts
    : asJsonArray(row.chapter_contracts);
  const chapters = Array.isArray(row.chapters)
    ? row.chapters
    : asJsonArray(row.chapters);

  const {
    contractIndex,
    chapterIndex,
    contract,
    chapter,
    continuityLedger
  } = payload;

  if (typeof contractIndex === "number" && contract) {
    chapterContracts[contractIndex] = contract;
  }

  if (typeof chapterIndex === "number" && chapter) {
    chapters[chapterIndex] = {
      ...(chapters[chapterIndex] || {}),
      ...chapter
    };
  }

  const ledger =
    continuityLedger ||
    rebuildLedgerFromChapters(chapters);

  await query(
    `UPDATE projects
     SET chapter_contracts = $2,
         chapters = $3,
         continuity_ledger = $4
     WHERE id = $1`,
    [id, chapterContracts, chapters, ledger]
  );

  return getProject(id);
}

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

export async function clearAndRewindFromChapter(id, chapterIndex) {
  const project = await getProject(id);
  if (!project) {
    throw new Error("Project not found");
  }

  const chapters = Array.isArray(project.chapters) ? project.chapters : [];
  const chapterContracts = Array.isArray(project.chapterContracts)
    ? project.chapterContracts
    : [];

  const keptChapters = chapters.filter((c) => {
    if (typeof c.index !== "number") return true;
    return c.index < chapterIndex;
  });

  const keptContracts = chapterContracts.filter((c) => {
    if (typeof c.index !== "number") return true;
    return c.index < chapterIndex;
  });

  const ledger = rebuildLedgerFromChapters(keptChapters);

  await query(
    `UPDATE projects
     SET chapter_contracts = $2,
         chapters = $3,
         continuity_ledger = $4
     WHERE id = $1`,
    [id, keptContracts, keptChapters, ledger]
  );

  return getProject(id);
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
