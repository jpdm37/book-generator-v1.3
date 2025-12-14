import OpenAI from "openai";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

import {
  getProject,
  _saveProjectDirect,
  rebuildLedgerFromChapters
} from "./storage.js";
import { buildStyleCard, buildUserCanon } from "./prompts.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

/**
 * Try very hard to parse model output as JSON.
 * Strips ```json fences and plain ``` fences before parsing.
 */
function safeJsonParse(text) {
  if (typeof text !== "string") {
    throw new Error("Model output is not a string.");
  }

  // Strip Markdown fences if present
  let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

  // First attempt: parse as-is
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    console.error("[engine] JSON.parse failed on full text:", e1.message);

    // Try to salvage the biggest JSON-looking chunk
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(
        "Model did not return JSON. First 400 chars: " +
          cleaned.slice(0, 400)
      );
    }

    let candidate = cleaned.slice(first, last + 1);

    // Trim from the end repeatedly and attempt JSON.parse again
    for (let i = 0; i < 30; i++) {
      try {
        return JSON.parse(candidate);
      } catch (e2) {
        const idx = candidate.lastIndexOf("\n");
        if (idx > first) {
          candidate = candidate.slice(0, idx).trim();
        } else {
          candidate = candidate.slice(0, candidate.length - 1).trim();
        }
        if (candidate.length <= 2) break;
      }
    }

    throw new Error(
      "Unable to parse JSON from model output. First 400 chars: " +
        cleaned.slice(0, 400)
    );
  }
}

/**
 * Single place where we actually call the OpenAI API.
 */
async function callModel({ instructions, input }) {
  console.log("[engine] calling model", DEFAULT_MODEL);

  try {
    const resp = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      temperature: 0.8
    });

    const text = resp.choices?.[0]?.message?.content;
    console.log("[engine] got completion length", text ? text.length : 0);

    if (!text) throw new Error("Empty model output");
    return text;
  } catch (err) {
    console.error("[engine] OpenAI error", err);
    throw err;
  }
}

/**
 * Merge a chapter's continuity object into the project's continuityLedger.
 */
function mergeContinuityLedger(project, continuity) {
  if (!continuity) return;

  const ledger = project.continuityLedger || {
    charactersState: {},
    locationsState: {},
    timeline: [],
    openLoops: []
  };

  if (continuity.charactersState && typeof continuity.charactersState === "object") {
    ledger.charactersState = {
      ...ledger.charactersState,
      ...continuity.charactersState
    };
  }

  if (continuity.locationsState && typeof continuity.locationsState === "object") {
    ledger.locationsState = {
      ...ledger.locationsState,
      ...continuity.locationsState
    };
  }

  if (Array.isArray(continuity.timelineEvents)) {
    ledger.timeline = [...(ledger.timeline || []), ...continuity.timelineEvents];
  }

  if (Array.isArray(continuity.openLoops)) {
    const set = new Set([...(ledger.openLoops || []), ...continuity.openLoops]);
    ledger.openLoops = Array.from(set);
  }

  project.continuityLedger = ledger;
}

/**
 * Build a compact continuity context up to (but not including) a given chapter index.
 */
function buildContinuityContext(project, uptoIndex) {
  const prev = (project.chapters || [])
    .filter(
      (c) =>
        c.index < uptoIndex && (c.continuity || c.userText || c.draftText)
    )
    .map((c) => ({
      index: c.index,
      title: c.title,
      continuity: c.continuity || null
    }));

  return {
    ledger: project.continuityLedger || null,
    previousChapters: prev
  };
}

/**
 * BRIEF + BIBLE
 */
export async function generateBookBriefAndBible(projectId) {
  console.log("[engine] generateBookBriefAndBible start", { projectId });

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const styleCard = buildStyleCard(project.inputs);
  const canon = buildUserCanon(project.inputs);

  const instructions = `
You are a senior book architect and continuity designer.
Return ONLY valid JSON.

JSON schema:
{
  "brief": {
    "titleSuggestion": string,
    "oneSentenceHook": string,
    "coreConcept": string,
    "genreLabel": string,
    "targetAudienceLabel": string,
    "positioning": string,
    "themes": string[],
    "comparisons": string[]
  },
  "bible": {
    "characters": [
      {
        "name": string,
        "role": string,
        "traits": string[],
        "wants": string,
        "fears": string,
        "voiceNotes": string,
        "appearance": string
      }
    ],
    "locations": [
      {
        "name": string,
        "type": string,
        "sensoryNotes": string,
        "rules": string
      }
    ],
    "worldRules": string[],
    "timelineSeed": string[]
  }
}
`.trim();

  const input = `
${styleCard}

User Canon:
${JSON.stringify(canon, null, 2)}

User Core Concept:
${project.inputs.coreConcept || ""}

Task:
- Refine the book's hook, positioning, and themes.
- Propose strong but flexible character and world scaffolding.
`.trim();

  const text = await callModel({ instructions, input });
  const json = safeJsonParse(text);

  project.brief = json.brief;
  project.bible = json.bible;

  if (!project.inputs.coreConcept && json.brief?.coreConcept) {
    project.inputs.coreConcept = json.brief.coreConcept;
  }

  const saved = await _saveProjectDirect(project);
  console.log("[engine] generateBookBriefAndBible complete");
  return saved;
}

/**
 * OUTLINE + CHAPTER CONTRACTS
 */
export async function generateOutline(projectId) {
  console.log("[engine] generateOutline start", { projectId });

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  // Ensure brief + bible exist
  if (!project.bible || !project.brief) {
    console.log("[engine] generateOutline: missing brief/bible, generating...");
    const updated = await generateBookBriefAndBible(projectId);
    Object.assign(project, updated);
  }

  const styleCard = buildStyleCard(project.inputs);

  const instructions = `
You are a master narrative planner.
Return ONLY valid JSON.

JSON schema:
{
  "outline": {
    "overallArc": string,
    "acts": [
      {
        "actIndex": number,
        "label": string,
        "goal": string
      }
    ],
    "chapterSummaries": [
      {
        "index": number,
        "title": string,
        "summary": string,
        "povCharacter": string,
        "setting": string,
        "conflict": string,
        "resolutionBeat": string
      }
    ]
  },
  "chapterContracts": [
    {
      "index": number,
      "title": string,
      "mustInclude": string[],
      "mustAvoid": string[],
      "continuityFocus": string[],
      "endingHookIntent": string
    }
  ]
}
`.trim();

  const input = `
${styleCard}

Book Brief:
${JSON.stringify(project.brief, null, 2)}

Bible:
${JSON.stringify(project.bible, null, 2)}

User chapter count: ${project.inputs.totalChapters}

Task:
Create a chapter-by-chapter outline with strong beginning-middle-end logic.
Then create a "chapter contract" per chapter that will guide drafting.
Avoid filler arcs.
`.trim();

  const text = await callModel({ instructions, input });
  console.log("[engine] generateOutline: model output length", text ? text.length : 0);

  const json = safeJsonParse(text);
  console.log("[engine] generateOutline: JSON parsed OK");

  project.outline = json.outline;
  project.chapterContracts = json.chapterContracts || [];

  const summaries = project.outline?.chapterSummaries || [];
  const existingByIndex = new Map(
    (project.chapters || []).map((c) => [c.index, c])
  );

  project.chapters = summaries.map((cs) => {
    const old = existingByIndex.get(cs.index);
    return {
      index: cs.index,
      title: cs.title,
      draftText: old?.draftText || "",
      userText: old?.userText || "",
      continuity: old?.continuity || null,
      approved: old?.approved || false
    };
  });

  project.continuityLedger = rebuildLedgerFromChapters(project.chapters);

  const saved = await _saveProjectDirect(project);
  console.log("[engine] generateOutline complete");
  return saved;
}

/**
 * NEXT CHAPTER GENERATION
 */
export async function generateNextChapter(projectId) {
  console.log("[engine] generateNextChapter start", { projectId });

  const project = await getProject(projectId);
  if (!project) {
    console.error("[engine] generateNextChapter: project not found");
    throw new Error("Project not found");
  }

  if (!project.outline) {
    console.log("[engine] generateNextChapter: no outline, generating...");
    const updated = await generateOutline(projectId);
    Object.assign(project, updated);
  }

  const chapters = project.chapters || [];
  const next = chapters.find((c) => !c.draftText);
  if (!next) {
    console.log("[engine] generateNextChapter: all chapters already drafted");
    return project;
  }

  console.log("[engine] generateNextChapter: next index", next.index);

  const chapterSummary = project.outline.chapterSummaries.find(
    (cs) => cs.index === next.index
  );
  const contract = (project.chapterContracts || []).find(
    (cc) => cc.index === next.index
  );

  const styleCard = buildStyleCard(project.inputs);
  const continuityContext = buildContinuityContext(project, next.index);

  const instructions = `
You are a top-tier novelist and continuity-obsessed editor.
Write the chapter prose AND then return a JSON object with prose + continuity.

Return ONLY valid JSON.

JSON schema:
{
  "title": string,
  "prose": string,
  "continuity": {
    "chapterSummary": string,
    "charactersState": { [name:string]: string },
    "locationsState": { [name:string]: string },
    "timelineEvents": string[],
    "openLoops": string[],
    "styleNotes": string
  }
}
`.trim();

  const input = `
${styleCard}

Book Brief:
${JSON.stringify(project.brief, null, 2)}

Bible:
${JSON.stringify(project.bible, null, 2)}

Chapter Summary:
${JSON.stringify(chapterSummary, null, 2)}

Chapter Contract:
${JSON.stringify(contract, null, 2)}

Continuity Context:
${JSON.stringify(continuityContext, null, 2)}

User word targets:
- Target: ${project.inputs.chapterTargetWords}
- Range: ${project.inputs.chapterMinWords}-${project.inputs.chapterMaxWords}

Task:
Write strong, publishable prose for this chapter.
- Use the outline and contract as constraints, not as text to repeat.
- Keep character appearance/traits consistent.
- Respect location names and world rules.
- End with a purposeful hook aligned to the contract.
`.trim();

  console.log("[engine] generateNextChapter: calling model...");
  const text = await callModel({ instructions, input });
  console.log(
    "[engine] generateNextChapter: model output length",
    text ? text.length : 0
  );

  const json = safeJsonParse(text);
  console.log("[engine] generateNextChapter: JSON parsed OK");

  next.title = json.title || next.title;
  next.draftText = json.prose || "";
  next.continuity = { ...(json.continuity || {}), source: "model" };
  next.approved = Boolean(next.userText && next.userText.trim().length > 50);

  mergeContinuityLedger(project, next.continuity);

  const saved = await _saveProjectDirect(project);
  console.log("[engine] generateNextChapter: save complete");
  return saved;
}

/**
 * REGENERATE A SPECIFIC CHAPTER (keeps user edits if present)
 */
export async function regenerateChapter(projectId, chapterIndex) {
  console.log("[engine] regenerateChapter start", { projectId, chapterIndex });

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.outline) throw new Error("Outline not found");

  const ch = (project.chapters || []).find((c) => c.index === chapterIndex);
  if (!ch) throw new Error("Chapter not found");

  const chapterSummary = project.outline.chapterSummaries.find(
    (cs) => cs.index === ch.index
  );
  const contract = (project.chapterContracts || []).find(
    (cc) => cc.index === ch.index
  );

  const styleCard = buildStyleCard(project.inputs);
  const continuityContext = buildContinuityContext(project, ch.index);

  const instructions = `
You are a top-tier novelist and continuity-obsessed editor.
Rewrite the chapter prose AND return JSON with prose + continuity.

Return ONLY valid JSON.

JSON schema:
{
  "title": string,
  "prose": string,
  "continuity": {
    "chapterSummary": string,
    "charactersState": { [name:string]: string },
    "locationsState": { [name:string]: string },
    "timelineEvents": string[],
    "openLoops": string[],
    "styleNotes": string
  }
}
`.trim();

  const input = `
${styleCard}

Book Brief:
${JSON.stringify(project.brief, null, 2)}

Bible:
${JSON.stringify(project.bible, null, 2)}

Chapter Summary:
${JSON.stringify(chapterSummary, null, 2)}

Chapter Contract:
${JSON.stringify(contract, null, 2)}

Existing User Text (if any):
${(ch.userText || "").slice(0, 2000)}

Continuity Context:
${JSON.stringify(continuityContext, null, 2)}

Task:
Regenerate the chapter to be stronger and cleaner, preserving key beats.
`.trim();

  console.log("[engine] regenerateChapter: calling model...");
  const text = await callModel({ instructions, input });
  console.log(
    "[engine] regenerateChapter: model output length",
    text ? text.length : 0
  );

  const json = safeJsonParse(text);
  console.log("[engine] regenerateChapter: JSON parsed OK");

  ch.title = json.title || ch.title;
  ch.draftText = json.prose || "";
  ch.continuity = { ...(json.continuity || {}), source: "model-regenerate" };
  // Don't auto-override userText; user chooses to keep/edit manually.
  ch.approved = Boolean(ch.userText && ch.userText.trim().length > 50);

  mergeContinuityLedger(project, ch.continuity);

  const saved = await _saveProjectDirect(project);
  console.log("[engine] regenerateChapter: save complete");
  return saved;
}

/**
 * Build a Markdown version of the book (for .md / .txt download).
 */
export async function compileBookMarkdown(projectId) {
  console.log("[engine] compileBookMarkdown", { projectId });

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  let output = "";

  const title =
    project.inputs.title ||
    project.brief?.titleSuggestion ||
    "Untitled Book";

  output += `# ${title}\n\n`;

  if (project.brief?.oneSentenceHook) {
    output += `> ${project.brief.oneSentenceHook}\n\n`;
  }

  const sorted = [...(project.chapters || [])].sort(
    (a, b) => a.index - b.index
  );

  for (const ch of sorted) {
    output += `## Chapter ${ch.index}: ${ch.title || ""}\n\n`;

    const text =
      (ch.userText && ch.userText.trim()) || ch.draftText || "";
    output += text.trim() + "\n\n";
  }

  return output;
}

/**
 * Build a DOCX buffer for download.
 */
export async function compileBookDocxBuffer(projectId) {
  console.log("[engine] compileBookDocxBuffer", { projectId });

  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const docChildren = [];

  const title =
    project.inputs.title ||
    project.brief?.titleSuggestion ||
    "Untitled Book";

  docChildren.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE
    })
  );

  if (project.brief?.oneSentenceHook) {
    docChildren.push(
      new Paragraph({ text: project.brief.oneSentenceHook })
    );
  }

  const sorted = [...(project.chapters || [])].sort(
    (a, b) => a.index - b.index
  );

  for (const ch of sorted) {
    docChildren.push(
      new Paragraph({
        text: `Chapter ${ch.index}: ${ch.title || ""}`,
        heading: HeadingLevel.HEADING_1
      })
    );

    const text =
      (ch.userText && ch.userText.trim()) || ch.draftText || "";
    const paragraphs = (text || "").split(/\n{2,}/);

    for (const p of paragraphs) {
      const clean = p.replace(/\n/g, " ").trim();
      if (!clean) continue;
      docChildren.push(new Paragraph(clean));
    }
  }

  const doc = new Document({ sections: [{ children: docChildren }] });

  return Packer.toBuffer(doc);
}
