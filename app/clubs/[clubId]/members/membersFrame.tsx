import Link from "next/link";
import type { ReactNode } from "react";
import { askingBadge } from "@/app/joinRequests";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import type { getDb } from "@/db";

// The Members pages (u6, ruled 2026-11-27): everything stays under the
// Members tab (§5.10), so every sub-page has the club header, the tabs with
// Members current, and a way back to the main Members page.

type Club = Parameters<typeof ClubHeader>[0]["club"];

export async function MembersFrame({
  db,
  club,
  role,
  back = true,
  wide = false,
  children,
}: {
  db: ReturnType<typeof getDb>;
  club: Club;
  role: string;
  // A sub-page's "Members" back link; the main page has none.
  back?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <GlobalShell
      current="clubs"
      wide={wide}
      header={
        <>
          <ClubHeader club={club} />
          <ClubTabs clubId={club.id} current="members" asking={await askingBadge(db, club.id, role)} />
        </>
      }
    >
      {back && (
        <p className="small flush mt14">
          <Link href={`/clubs/${club.id}/members`} className="tap back-link">
            <span aria-hidden="true">←</span> Members
          </Link>
        </p>
      )}
      {children}
    </GlobalShell>
  );
}

// One row of a card that opens a page: a label, its current value, and ›.
export function RowLink({ href, label, value, className = "" }: { href: string; label: string; value?: string; className?: string }) {
  return (
    <Link href={href} className={`row-link ${className}`.trim()}>
      <span className="grow">
        <span className="row-link-label">{label}</span>
        {value && <span className="tiny dim row-link-value">{value}</span>}
      </span>
      <span className="row-link-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
