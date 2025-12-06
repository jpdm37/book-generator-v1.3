# AI Book Generator v1.1.1 (Render-ready)

This is a single-service Node/Express app that serves both the frontend UI and backend API.
Projects, outlines, chapters, and continuity are stored in Postgres.

## Key features
- Structured inputs (genre, tone, voice, audience, humour, chapter length)
- Outline-first generation
- Chapter-by-chapter drafting with a rolling continuity ledger
- Manual editing of chapters
- Regeneration with continuity rewind (clears that chapter and later chapters)
- Download as Markdown or DOCX
- Multi-project dashboard

## Environment variables
Required:
- OPENAI_API_KEY
- DATABASE_URL

Optional:
- OPENAI_MODEL (default: gpt-5.1)
- PGSSL=false (disable ssl if your environment requires it)

## Local run
1. Install deps:
   npm install
2. Set env vars:
   - OPENAI_API_KEY
   - DATABASE_URL
3. Apply schema:
   psql "$DATABASE_URL" -f sql/schema.sql
4. Start:
   npm start

## Render deploy (single service)
1. Push to GitHub
2. Create Render Postgres
3. Create Render Web Service from this repo
4. Set env vars:
   - OPENAI_API_KEY
   - DATABASE_URL (use Internal URL)
   - OPENAI_MODEL (optional)
5. Run schema once via psql using the External URL from your local machine.
