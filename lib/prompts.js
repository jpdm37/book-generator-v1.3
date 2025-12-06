const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function buildStyleCard(inputs = {}) {
  const totalChapters = clamp(Number(inputs.totalChapters || 12), 1, 200);
  const target = clamp(Number(inputs.chapterTargetWords || 2000), 300, 12000);
  const minW = clamp(Number(inputs.chapterMinWords || 1500), 200, 12000);
  const maxW = clamp(Number(inputs.chapterMaxWords || 3000), minW, 20000);

  return `
STYLE CARD
Genre: ${inputs.genre || "General Fiction"}
Sub-style: ${inputs.subStyle || "—"}
Tone: ${inputs.tone || "Balanced"}
Voice/POV: ${inputs.voice || "3rd Person Limited"}
Humour level: ${inputs.humourLevel || "Medium"}
Target audience: ${inputs.targetAudience || "General Fiction"} (${inputs.ageRange || "18+"})
Planned chapters: ${totalChapters}
Chapter word target: ${target} (range ${minW}-${maxW})
Title (if provided): ${inputs.title || "—"}
Core concept (if provided): ${inputs.coreConcept || "—"}

Writing priorities:
- Clear plot causality and character-driven stakes.
- Consistent internal logic.
- Cooked prose over placeholder text.
- Minimal recap unless structurally necessary.
`.trim();
}

export function buildUserCanon(inputs = {}) {
  const chars = (inputs.characters || "").trim();
  const locs = (inputs.locations || "").trim();
  const notes = (inputs.additionalNotes || "").trim();

  return `
USER CANON (authoritative user-provided facts)
Characters (free text):
${chars || "None provided. Invent suitable characters that match the genre and core concept."}

Locations (free text):
${locs || "None provided. Invent suitable locations that match the genre and core concept."}

Additional notes:
${notes || "None."}
`.trim();
}
