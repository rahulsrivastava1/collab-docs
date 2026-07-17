import { Pool, type QueryResultRow } from "pg";

declare global {
  var pgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Pool({
    connectionString,
    max: 10,
  });
}

export const pool = globalThis.pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalThis.pgPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}
