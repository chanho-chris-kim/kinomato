import Link from "next/link";
import type { ReactNode } from "react";
import { roleLabel } from "@/lib/roles";
import { nameOf, type ClubMembership } from "./members";

// The club's member list, in its two places: the rail on Tonight (from
// 1120px) and the Members tab. Either way the viewer's own row says
// "(you)" in words and carries the accent highlight — never colour alone.
// Since step 5c this marker is how the page shows who you are; "You are:
// …" is gone, because identity is the account now.

// One order in both places: who joined first.
export function byJoinedAt(a: ClubMembership, b: ClubMembership): number {
  return a.joinedAt.getTime() - b.joinedAt.getTime();
}

// "Priya S." -> "PS" — decorative only, never an identity key.
function initials(displayName: string): string {
  return displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function You() {
  return <span className="you"> (you)</span>;
}

export function RailMembers({
  members,
  meId,
  addPersonHref,
}: {
  members: ClubMembership[];
  meId: string;
  // Owners and admins only: a way to the Members tab's Add a person form.
  addPersonHref?: string;
}) {
  return (
    <>
      <h2 className="sec">Members</h2>
      <ul className="stack gap8" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {members.map((m) => (
          <li key={m.id} className="row">
            <span className={`avatar ${m.id === meId ? "me" : ""}`} aria-hidden="true">
              {initials(nameOf(m))}
            </span>
            <span className="small">
              {nameOf(m)}
              {m.id === meId && <You />}
            </span>
          </li>
        ))}
      </ul>
      {addPersonHref && (
        <p className="small mt14">
          <Link href={addPersonHref} style={{ color: "var(--accent)" }}>
            Add a person →
          </Link>
        </p>
      )}
    </>
  );
}

// Every member sees each person's role in words (the leftover `guest`
// reads as Member). `controls`: the owner's per-member role controls
// (docs/onboarding-spec.md §5.10, ruled 2026-11-11), nothing for anyone
// else.
export function MemberCards({
  members,
  meId,
  controls,
}: {
  members: ClubMembership[];
  meId: string;
  controls?: (member: ClubMembership) => ReactNode;
}) {
  return (
    <ul className="stack gap8" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {members.map((m) => {
        const memberControls = controls?.(m);
        return (
          <li key={m.id} className={`card ${m.id === meId ? "me" : ""}`}>
            <div className="row">
              <span className={`avatar ${m.id === meId ? "me" : ""}`} aria-hidden="true">
                {initials(nameOf(m))}
              </span>
              <span className="member-name" style={{ minWidth: 0 }}>
                {nameOf(m)}
                {m.id === meId && <You />}
              </span>
              <span className="chip member-role" style={{ marginLeft: "auto" }}>
                {roleLabel(m.role)}
              </span>
            </div>
            {memberControls && <div className="row gap8 mt14 role-controls">{memberControls}</div>}
          </li>
        );
      })}
    </ul>
  );
}
