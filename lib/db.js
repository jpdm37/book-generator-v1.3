import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sslEnabled = String(process.env.PGSSL || "").toLowerCase() !== "false";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslEnabled ? { rejectUnauthorized: false } : false
});

export async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
