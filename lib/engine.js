import OpenAI from "openai";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";

import { getProject, _saveProjectDirect, rebuildLedgerFromChapters } from "./storage.js";
import { buildStyleCard, buildUserCanon } from "./prompts.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    try {
      return JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        "Model did not return valid JSON. " +
        "Try setting OPENAI_MODEL to a JSON-reliable model. " +
        "Raw output (first 500 chars): " + stripped.slice(0, 500)
      );
    }
  }
}

async function callModel({ instructions, input }) {
  const resp = await client.responses.create({
    model: DEFAULT_MODEL,
    instructions,
    input
  });

  const text = resp.output_text;
  if (!text) throw new Error("Empty model output");
  return text;
}

function mergeContinuityLedger(project, continuity) {
  if (!continuity) return;

  const ledger = project.continuityLedger || {
    charactersState: {},
    locationsState: {},
    timeline: [],
    openLoops: []
  };

  if (continuity.charactersState && typeof continuity.charactersState === "object") {
    ledger.charactersState = { ...ledger.charactersState, ...continuity.charactersState };
  }
  if (continuity.locationsState && typeof continuity.locationsState === "object") {
    ledger.locationsState = { ...ledger.locationsState, ...continuity.locationsState };
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

function buildContinuityContext(project, uptoIndex) {
  const prev = (project.chapters || [])
    .filter(c => c.index < uptoIndex && (c.continuity || c.userText || c.draftText))
    .map(c => ({
      index: c.index,
      title: c.title,
      continuity: c.continuity
    }));

  return `
Prior chapter continuity (authoritative):
${JSON.stringify(prev, null, 2)}

Global ledger (rolling state):
${JSON.stringify(project.continuityLedger || {}, null, 2)}
`.trim();
}

export async function generateBookBriefAndBible(projectId) {
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
    "themes": string[],
    "targetAudience": string,
    "toneNotes": string,
    "structureRecommendation": string,
    "chapterCount": number
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

${canon}

Task:
1) Convert user inputs into a sharp book brief.
2) Expand characters/locations into a "bible" that will be used for every chapter.
3) If user didn't provide explicit details, invent them conservatively and consistently with genre.
4) Ensure chapterCount matches user totalChapters.
`.trim();

  const text = await callModel({ instructions, input });
  const json = safeJsonParse(text);

  project.brief = json.brief;
  project.bible = json.bible;

  if (!project.inputs.coreConcept && json.brief?.coreConcept) {
    project.inputs.coreConcept = json.brief.coreConcept;
  }

  return _saveProjectDirect(project);
}

export async function generateOutline(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.bible || !project.brief) {
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
    "actStructure": string,
    "chapterSummaries": [
      { "index": number, "title": string, "summary": string, "keyBeats": string[], "setupPayoffLinks": string[] }
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
  const json = safeJsonParse(text);

  project.outline = json.outline;
  project.chapterContracts = json.chapterContracts || [];

  const summaries = project.outline?.chapterSummaries || [];
  const existingByIndex = new Map((project.chapters || []).map(c => [c.index, c]));

  project.chapters = summaries.map(cs => {
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

  return _saveProjectDirect(project);
}

export async function generateNextChapter(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.outline) {
    const updated = await generateOutline(projectId);
    Object.assign(project, updated);
  }

  const next = (project.chapters || []).find(c => !c.draftText);
  if (!next) return project;

  const chapterSummary = project.outline.chapterSummaries.find(cs => cs.index === next.index);
  const contract = (project.chapterContracts || []).find(cc => cc.index === next.index);

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

Outline summary for this chapter:
${JSON.stringify(chapterSummary, null, 2)}

Chapter contract:
${JSON.stringify(contract || {}, null, 2)}

${continuityContext}

Hard constraints:
- Word count target ~${project.inputs.chapterTargetWords} (range ${project.inputs.chapterMinWords}-${project.inputs.chapterMaxWords}).
- Keep character appearance/traits consistent.
- Respect location names and world rules.
- End with a purposeful hook aligned to contract.

Task:
Write strong, publishable prose.
Avoid repetition of the outline.
`.trim();

  const text = await callModel({ instructions, input });
  const json = safeJsonParse(text);

  next.title = json.title || next.title;
  next.draftText = json.prose || "";
  next.continuity = { ...(json.continuity || {}), source: "model" };
  next.approved = Boolean(next.userText && next.userText.trim().length > 50);

  mergeContinuityLedger(project, next.continuity);

  return _saveProjectDirect(project);
}

export async function regenerateChapter(projectId, chapterIndex) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!project.outline) throw new Error("Outline not found");

  const ch = (project.chapters || []).find(c => c.index === chapterIndex);
  if (!ch) throw new Error("Chapter not found");

  const chapterSummary = project.outline.chapterSummaries.find(cs => cs.index === ch.index);
  const contract = (project.chapterContracts || []).find(cc => cc.index === ch.index);

  const styleCard = buildStyleCard(project.inputs);
  const continuityContext = buildContinuityContext(project, ch.index);

  const instructions = `
You are a top-tier novelist and continuity-obsessed editor.
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

Outline summary for this chapter:
${JSON.stringify(chapterSummary, null, 2)}

Chapter contract:
${JSON.stringify(contract || {}, null, 2)}

${continuityContext}

Task:
Regenerate this chapter with cleaner prose, stronger pacing, and reduced redundancy.
Maintain absolute continuity with prior chapters.
`.trim();

  const text = await callModel({ instructions, input });
  const json = safeJsonParse(text);

  ch.title = json.title || ch.title;
  ch.draftText = json.prose || "";
  ch.userText = ch.userText || "";
  ch.continuity = { ...(json.continuity || {}), source: "model" };
  ch.approved = Boolean(ch.userText && ch.userText.trim().length > 50);

  project.continuityLedger = rebuildLedgerFromChapters(project.chapters);

  return _saveProjectDirect(project);
}

export async function compileBookMarkdown(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const title = project.inputs.title || project.brief?.titleSuggestion || "Untitled Book";

  const chapters = (project.chapters || [])
    .sort((a, b) => a.index - b.index)
    .map(c => {
      const text = (c.userText && c.userText.trim()) ? c.userText : c.draftText;
      return `## Chapter ${c.index}: ${c.title}\n\n${text || ""}\n`;
    })
    .join("\n");

  const front = `# ${title}\n\n`;
  const briefBlock = project.brief
    ? `---\n**One-sentence hook:** ${project.brief.oneSentenceHook || ""}\n---\n\n`
    : "";

  return front + briefBlock + chapters;
}

export async function compileBookDocxBuffer(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");

  const title = project.inputs.title || project.brief?.titleSuggestion || "Untitled Book";

  const docChildren = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE })
  ];

  if (project.brief?.oneSentenceHook) {
    docChildren.push(new Paragraph({ text: project.brief.oneSentenceHook }));
  }

  const sorted = [...(project.chapters || [])].sort((a, b) => a.index - b.index);

  for (const ch of sorted) {
    docChildren.push(
      new Paragraph({
        text: `Chapter ${ch.index}: ${ch.title}`,
        heading: HeadingLevel.HEADING_1
      })
    );

    const text = (ch.userText && ch.userText.trim()) ? ch.userText : ch.draftText;
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
