import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { magicLinks, users } from "@/db/schema";
import { getSessionUserId } from "@/app/session";
import { evaluateSignIn, hashToken } from "@/lib/authCredentials";
import { verifyLink } from "./actions";

// Where a sign-in link lands (docs/onboarding-spec.md §5.5). GET never
// signs anyone in and never consumes the link: email security scanners
// open every URL in an inbound message, and a link used up by a scanner
// is a link the person never gets to use. Only the button does.
//
// A link isn't subject to the code's attempt limit — wrong codes typed
// elsewhere don't disable the link in the same email.
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [link] = token
    ? await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hashToken(token)))
    : [];
  const state = link ? evaluateSignIn(link, new Date()) : "expired";

  if (!link || state === "consumed" || state === "expired") {
    const retry = link ? `/login?email=${encodeURIComponent(link.email)}` : "/login";
    return (
      <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          This link has expired
        </h1>
        <p className="small muted mt-1">Sign-in links work once, for 15 minutes.</p>
        <p className="mt20">
          <Link href={retry} className="btn primary" style={{ display: "block", textAlign: "center" }}>
            Request a new one
          </Link>
        </p>
      </main>
    );
  }

  // Already signed in as someone else in this browser: say so on the
  // button, never switch silently.
  const currentUserId = await getSessionUserId(db);
  const [currentUser] = currentUserId
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, currentUserId))
    : [];
  const switching = currentUser && currentUser.email !== link.email;

  return (
    <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Sign in as {link.email}
      </h1>
      <form action={verifyLink} className="mt20">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn primary">
          {switching ? `Sign out of ${currentUser.email} and sign in as ${link.email}` : "Sign in"}
        </button>
      </form>
    </main>
  );
}
