import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { cache } from "react";
import * as schema from "./schema";

// This runs inside the Cloudflare Worker (via OpenNext), never locally —
// see db/seed.ts and drizzle.config.ts for the node/postgres-js driver
// used outside the Worker. Two things matter here, both from OpenNext
// Cloudflare's own guidance (opennext.js.org/cloudflare/howtos/db):
//
// 1. No module-scope client. Workers doesn't allow reusing a connection
//    across requests — a plain top-level `export const db = drizzle(...)`
//    would work in local testing and then fail under real concurrent
//    traffic. getDb() creates a fresh client every time it's called.
// 2. cache() (from "react") scopes that per-call cost to once per
//    request: multiple getDb() calls within the same request's render
//    (or the same Server Action) reuse the same instance; the next
//    request gets a new one. This is safe specifically because
//    neon-http has no persistent connection or pool to begin with —
//    every query is a stateless HTTP call — so "fresh per request" costs
//    nothing extra, unlike a socket-based driver.
export const getDb = cache(() => {
  const sql = neon(process.env.DATABASE_URL!);
  return drizzle(sql, { schema });
});
