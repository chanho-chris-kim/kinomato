import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { readFormEcho } from "@/app/formEcho";
import { findActiveMembership } from "@/app/invites";
import { clubForConfirmedCode, myJoinRequests } from "@/app/joinRequests";
import { GlobalShell } from "@/app/shell";
import { signupOpen } from "@/app/signIn";
import { clubs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formatJoinCode } from "@/lib/joinCode";
import { timeAgo } from "@/lib/format";
import { askToJoinAction, cancelJoinRequestAction, lookUpCodeAction } from "./actions";

// Join a friend's club with its code (u5, ruled 2026-11-25; details
// 2026-11-26). Signed in only: signed out goes to /login and comes back
// here (app/auth.ts). The code never rides in the URL (§11.6): after a
// lookup it's in the form-echo cookie and the confirm form. A right code
// shows the club's name and nothing else about it.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; error?: string; sent?: string; in?: string; cancelled?: string }>;
}) {
  const { confirm, error, sent, in: inClubId, cancelled } = await searchParams;
  const user = await requireUser("/join");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const now = new Date(Date.now());
  const echo = confirm || error ? await readFormEcho() : {};
  const confirming = confirm ? await clubForConfirmedCode(db, echo.clubId, echo.code) : null;
  const mine = await myJoinRequests(db, user.id, now);
  const justSent = sent ? mine.pending.find((r) => r.id === sent) : undefined;
  // "You're already in {club}": only for a club they really are in.
  const alreadyIn =
    inClubId && /^[0-9a-f-]{36}$/i.test(inClubId) && (await findActiveMembership(db, inClubId, user.id))
      ? (await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, inClubId)))[0]
      : undefined;

  return (
    <GlobalShell current="clubs">
      <div className="signin-main">
        <h1 className="h-display stage-title mt14">Join a friend&apos;s club</h1>
        <p className="small muted mt-1">
          Clubs are private, so they can&apos;t be searched. Ask someone in the club for its code.
        </p>

        {error && echo.error && (
          <p className="small mt14 warn" role="alert">
            {echo.error}
          </p>
        )}
        {cancelled && (
          <p className="small mt14" role="status">
            Request cancelled.
          </p>
        )}
        {alreadyIn && (
          <section className="card mt14 already-in" aria-labelledby="already-in-heading">
            <h2 id="already-in-heading" className="sec flush">
              You&apos;re already in {alreadyIn.name}
            </h2>
            <Link href={`/clubs/${alreadyIn.id}`} className="btn primary block-link mt14">
              Go to {alreadyIn.name}
            </Link>
          </section>
        )}

        {justSent ? (
          <section className="card now mt14 request-sent" aria-labelledby="sent-heading">
            <h2 id="sent-heading" className="sec flush">
              Request sent to {justSent.clubName}.
            </h2>
            <p className="small muted mt-1">
              The club&apos;s owner or an admin will let you in. We&apos;ll email you when they do.
            </p>
            <form action={cancelJoinRequestAction.bind(null, justSent.id)} className="mt14">
              <button type="submit" className="btn ghost">
                Cancel request
              </button>
            </form>
          </section>
        ) : confirming ? (
          <section className="card now mt14 confirm-club" aria-labelledby="confirm-heading">
            <p className="eyebrow">Club code {formatJoinCode(echo.code ?? "")}</p>
            <h2 id="confirm-heading" className="h-display stage-title flush confirm-club-name">
              {confirming.name}
            </h2>
            <form action={askToJoinAction} className="mt14">
              <input type="hidden" name="code" value={echo.code} />
              <button type="submit" className="btn primary">
                Ask to join {confirming.name}
              </button>
            </form>
            <p className="small mt14 flush">
              <Link href="/join" className="underline tap">
                Not this club? Try another code
              </Link>
            </p>
          </section>
        ) : (
          <form action={lookUpCodeAction} className="card mt14 stack gap14 join-form">
            <label className="small muted">
              Club code
              <div className="search mt-1">
                <input
                  name="code"
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={20}
                  placeholder="XXXX-XXXX"
                  defaultValue={error ? (echo.code ?? "") : ""}
                />
              </div>
            </label>
            <button type="submit" className="btn primary">
              Ask to join
            </button>
            <p className="tiny dim flush">Got a personal invite link instead? Just open it.</p>
          </form>
        )}

        <ul className="plain-list mt14 promise-lines">
          <li className="small muted">Nobody joins without the club saying yes.</li>
          <li className="small muted">Only your display name is shared with them until you&apos;re in.</li>
        </ul>

        {(mine.pending.some((r) => r.id !== justSent?.id) || mine.declined.length > 0) && (
          <section className="mt20" aria-labelledby="my-requests-heading">
            <h2 id="my-requests-heading" className="sec">
              Your requests
            </h2>
            <ul className="plain-list stack gap8 my-requests">
              {mine.pending
                .filter((r) => r.id !== justSent?.id)
                .map((r) => (
                  <li key={r.id} className="card between gap8">
                    <span className="small">
                      Waiting on {r.clubName}
                      <span className="tiny dim"> · asked {timeAgo(r.createdAt, now)}</span>
                    </span>
                    <form action={cancelJoinRequestAction.bind(null, r.id)}>
                      <button type="submit" className="btn ghost auto" aria-label={`Cancel request to ${r.clubName}`}>
                        Cancel request
                      </button>
                    </form>
                  </li>
                ))}
              {mine.declined.map((r) => (
                <li key={r.id} className="card small declined-request">
                  {r.clubName} didn&apos;t accept your request.
                </li>
              ))}
            </ul>
          </section>
        )}

        {signupOpen() && (
          <p className="small mt20">
            Don&apos;t know anyone with a club?{" "}
            <Link href="/new" className="underline tap">
              Start your own
            </Link>
          </p>
        )}
      </div>
    </GlobalShell>
  );
}
