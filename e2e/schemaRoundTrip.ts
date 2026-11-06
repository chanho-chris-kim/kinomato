import { pushSchema } from "drizzle-kit/api";
import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

// What a second `drizzle-kit push` would run against a database that
// db/schema.ts was just pushed to. A schema that round-trips gives none.
// If it gives any, every real push (production's, by hand) shows those
// statements as noise — dropping and re-adding constraints, re-setting
// defaults — and buries the change it was meant to make.
//
// drizzle-kit's own API, computing the same diff `push` does, without
// applying it (pushSchema's statementsToExecute; nothing calls apply). The
// CLI can't be used for this check: on a table with rows it stops at an
// interactive "truncate?" prompt before listing anything.
//
// Known drizzle-kit 0.31 bug, allowed and nothing else: it reads an empty
// text-array default ('{}'::text[]) back as '{""}' (defaultForColumn splits
// the empty array into one empty string), so these columns' defaults are
// re-set on every push. No schema spelling avoids it short of dropping the
// defaults, which would change the database. Still there in 0.31.11.
export const KNOWN_DRIZZLE_KIT_NOISE = [
  `ALTER TABLE "films" ALTER COLUMN "genres" SET DEFAULT '{}';`,
  `ALTER TABLE "films" ALTER COLUMN "directors" SET DEFAULT '{}';`,
  `ALTER TABLE "films" ALTER COLUMN "cast" SET DEFAULT '{}';`,
  `ALTER TABLE "films" ALTER COLUMN "keywords" SET DEFAULT '{}';`,
  `ALTER TABLE "watchlist_items" ALTER COLUMN "tags" SET DEFAULT '{}';`,
];

// Run it on empty tables (straight after the push, before seeding): on a
// table with rows, drizzle-kit's suggestions step asks interactively
// whether to truncate before adding a unique constraint, and waits.
export async function schemaRoundTripStatements(databaseUrl: string): Promise<string[]> {
  const client = postgres(databaseUrl, { onnotice: () => {}, max: 1 });
  try {
    const db = drizzle(client);
    // pushSchema reads `.rows` off execute(); postgres-js returns the rows
    // array itself.
    const instance = { execute: async (query: SQL) => ({ rows: await db.execute(query) }) };
    const { statementsToExecute } = await pushSchema(schema, instance as never);
    return statementsToExecute;
  } finally {
    await client.end();
  }
}
