import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { monthDay } from "@/lib/format";
import { canChangeRole, canRemove, canTransferOwnership, roleLabel, type RoleMember } from "@/lib/roles";
import { makeAdmin, removeAdmin, removeMember, transferOwnership } from "../../actions";
import { loadClubMemberships, nameOf, type ClubMembership } from "../../members";
import { initials } from "../../memberViews";
import { MembersFrame } from "../membersFrame";

// Manage a person (u6, ruled 2026-11-27): only for a viewer lib/roles.ts
// allows at least one action on them, else a 404 (as for any page they
// can't use). It offers exactly those actions, through the same actions
// and two-tap confirms as before (?transfer=1, ?remove=1); the actions
// check every rule again.
export default async function ManagePersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string; membershipId: string }>;
  searchParams: Promise<{ transfer?: string; remove?: string; roles?: string }>;
}) {
  const { clubId, membershipId } = await params;
  const { transfer, remove, roles } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members/${membershipId}`);
  if (!/^[0-9a-f-]{36}$/i.test(membershipId)) notFound();
  const [[club], memberships] = await Promise.all([
    db.select().from(clubs).where(eq(clubs.id, clubId)),
    loadClubMemberships(db, clubId),
  ]);
  const person = memberships.find((m) => m.id === membershipId && m.leftAt === null);
  if (!person) notFound();

  const asRole = (m: Pick<ClubMembership, "id" | "clubId" | "role" | "leftAt">): RoleMember => ({ membershipId: m.id, clubId: m.clubId, role: m.role, leftAt: m.leftAt });
  const may = {
    makeAdmin: canChangeRole(asRole(me), asRole(person), "admin"),
    removeAdmin: canChangeRole(asRole(me), asRole(person), "member"),
    transfer: canTransferOwnership(asRole(me), asRole(person)),
    remove: canRemove(asRole(me), asRole(person)),
  };
  if (!may.makeAdmin && !may.removeAdmin && !may.transfer && !may.remove) notFound();
  const name = nameOf(person);
  const here = `/clubs/${clubId}/members/${person.id}`;

  return (
    <MembersFrame db={db} club={club} role={me.role}>
      <div className="person-head mt14">
        <span className="avatar large" aria-hidden="true">
          {initials(name)}
        </span>
        <div>
          <h2 className="h-display stage-title flush page-title">{name}</h2>
          <p className="small muted flush person-meta">
            {roleLabel(person.role)} · joined {monthDay(person.joinedAt, club.timezone)}
          </p>
        </div>
      </div>
      {roles === "saved" && (
        <p className="small mt14 saved-note" role="status">
          Saved.
        </p>
      )}

      {(may.makeAdmin || may.removeAdmin || may.transfer) && (
        <section className="card mt20 role-card" aria-labelledby="role-heading">
          <h2 id="role-heading" className="sec flush">
            Role
          </h2>
          <div className="stack gap8 mt14">
            {may.makeAdmin && (
              <form action={makeAdmin.bind(null, clubId, person.id)}>
                <button type="submit" className="btn">
                  Make {name} an admin
                </button>
              </form>
            )}
            {may.removeAdmin && (
              <form action={removeAdmin.bind(null, clubId, person.id)}>
                <button type="submit" className="btn" aria-label={`Remove ${name} as admin`}>
                  Remove admin
                </button>
              </form>
            )}
            {may.transfer &&
              (transfer ? (
                // The two-tap transfer's confirm (ruled 2026-11-11).
                <div className="card transfer-confirm">
                  <p className="small flush">
                    Make {name} the owner of {club.name}? You&apos;ll become an admin.
                  </p>
                  <div className="row gap8 mt14">
                    <form action={transferOwnership.bind(null, clubId, person.id)}>
                      <button type="submit" className="btn primary auto">
                        Make owner
                      </button>
                    </form>
                    <Link href={here} className="btn ghost auto">
                      Cancel
                    </Link>
                  </div>
                </div>
              ) : (
                <div>
                  <Link href={`${here}?transfer=1`} className="btn block-link">
                    Hand the club over to {name}
                  </Link>
                  <p className="tiny dim mt-1 flush">
                    Handing over makes {name} the owner and you an admin. You&apos;ll confirm first.
                  </p>
                </div>
              ))}
          </div>
        </section>
      )}

      {may.remove && (
        <section className="card danger-card mt20 remove-card" aria-labelledby="remove-heading">
          <h2 id="remove-heading" className="sec flush">
            Remove from the club
          </h2>
          <p className="small muted mt-1 flush">
            {name}&apos;s past votes and ratings stay with the club. You&apos;ll confirm first.
          </p>
          {remove ? (
            // Two-tap removal (ruled 2026-11-11).
            <div className="remove-confirm mt14">
              <p className="small flush">
                Remove {name} from {club.name}? Their past picks, votes and ratings stay in its history.
              </p>
              <div className="row gap8 mt14">
                <form action={removeMember.bind(null, clubId, person.id)}>
                  <button type="submit" className="btn danger auto">
                    Remove
                  </button>
                </form>
                <Link href={here} className="btn ghost auto">
                  Cancel
                </Link>
              </div>
            </div>
          ) : (
            <Link href={`${here}?remove=1`} className="btn danger block-link mt14">
              Remove {name}
            </Link>
          )}
        </section>
      )}
    </MembersFrame>
  );
}
