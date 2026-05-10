import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 30000)
});

