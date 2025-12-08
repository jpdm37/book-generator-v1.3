import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import {
  listProjects,
  getProject,
  createProject,
  updateProjectInputs,
  deleteProject,
  saveUserEdits,
  clearAndRewindFromChapter
} from "./lib/storage.js";

import {
  generateBookBriefAndBible,
  generateOutline,
  generateNextChapter,
  regenerateChapter,
  compileBookMarkdown,
  compileBookDocxBuffer
} from "./lib/engine.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await listProjects();
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const project = await createProject(req.body || {});
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const project = await getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id/inputs", async (req, res) => {
  try {
    const project = await updateProjectInputs(req.params.id, req.body || {});
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    await deleteProject(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/brief-bible", async (req, res) => {
  try {
    const project = await generateBookBriefAndBible(req.params.id);
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/outline", async (req, res) => {
  try {
    const project = await generateOutline(req.params.id);
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/chapters/next", async (req, res) => {
  try {
    const project = await generateNextChapter(req.params.id);
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/projects/:id/chapters/:index/edits", async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const project = await saveUserEdits(req.params.id, idx, req.body || {});
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects/:id/chapters/:index/regenerate", async (req, res) => {
  try {
    const idx = Number(req.params.index);
    await clearAndRewindFromChapter(req.params.id, idx);
    const project = await regenerateChapter(req.params.id, idx);
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id/download/markdown", async (req, res) => {
  try {
    const md = await compileBookMarkdown(req.params.id);
    const safeName = `book-${req.params.id}.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(md);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects/:id/download/docx", async (req, res) => {
  try {
    const buf = await compileBookDocxBuffer(req.params.id);
    const safeName = `book-${req.params.id}.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("*", (req, res) => {
  if (req.url.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Book Generator v1.3.1 running on port ${PORT}`);
});
