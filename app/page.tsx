import Link from "next/link";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";

// Live club list — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  const allClubs = await getDb().select().from(clubs);

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">kinomato</h1>
      {allClubs.length === 0 ? (
        <p className="mt-2">No clubs yet. Run `npm run db:seed`.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {allClubs.map((c) => (
            <li key={c.id}>
              <Link href={`/clubs/${c.id}`} className="underline">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
