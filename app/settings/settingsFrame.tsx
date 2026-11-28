import Link from "next/link";
import type { ReactNode } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { licensingStatusFor } from "@/app/consent";
import { OldAnchorRedirect } from "@/app/OldAnchorRedirect";
import { GlobalShell } from "@/app/shell";
import { initials } from "@/app/clubs/[clubId]/memberViews";
import { canOptInToLicensing, isLicensingActive } from "@/lib/consent";
import { shownName } from "@/lib/displayName";
import { currentLegal } from "@/lib/legal";
import { privacySummary, remindersSummary } from "@/lib/settingsSummary";
import { signOut } from "./actions";

// Settings (u7, ruled 2026-11-27; what's in it, docs/onboarding-spec.md
// §5.9). One menu and the page beside it: on a phone /settings is the
// menu and each page is its own screen with a way back; from 900px the
// menu is a left column on every page and /settings shows Account beside
// it. Every action and server check is the one Settings always had.

export type SettingsSection = "account" | "reminders" | "privacy" | "sign-out" | "delete";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  ageBracket: "13_17" | "18_plus" | null;
  emailReminders: boolean;
};

// Before u7 Settings was one page, and links into it named a section by
// its hash.
const MOVED_SECTIONS: Record<string, string> = {
  "#your-name": "/account",
  "#your-email": "/account",
  "#reminders": "/reminders",
  "#reminders-heading": "/reminders",
  "#data-sharing": "/privacy",
  "#your-data": "/privacy",
  "#signing-out": "/sign-out",
  "#delete-account": "/delete-account",
  "#delete-account-heading": "/delete-account",
};

// The person's active clubs with their reminder mute, by name.
export async function reminderClubsFor(userId: string) {
  return (
    await getDb()
      .select({ clubId: clubs.id, clubName: clubs.name, mutedAt: memberships.remindersMutedAt })
      .from(memberships)
      .innerJoin(clubs, eq(memberships.clubId, clubs.id))
      .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)))
  )
    .map((c) => ({ clubId: c.clubId, clubName: c.clubName, muted: c.mutedAt !== null }))
    .sort((a, b) => a.clubName.localeCompare(b.clubName));
}

// Data sharing for this person: null for 13–17, who never see it (§11.2).
export async function sharingFor(user: User) {
  if (!canOptInToLicensing(user.ageBracket)) return null;
  const licensing = await licensingStatusFor(getDb(), user.id);
  if (!licensing) return null;
  return {
    licensing,
    sharingNow: isLicensingActive(licensing.rows, user.ageBracket, currentLegal().licensing.version),
  };
}

const ICONS: Record<"account" | "reminders" | "privacy", ReactNode> = {
  account: (
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  ),
  reminders: (
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  ),
  privacy: (
    <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  ),
};

function MenuRow({
  href,
  icon,
  title,
  value,
  current,
}: {
  href: string;
  icon: keyof typeof ICONS;
  title: string;
  value: string;
  current: boolean;
}) {
  return (
    <Link href={href} className="menu-row" aria-current={current ? "page" : undefined}>
      <svg className="menu-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <span className="grow">
        <span className="row-link-label">{title}</span>
        <span className="tiny dim row-link-value">{value}</span>
      </span>
      <span className="row-link-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export async function SettingsFrame({
  user,
  current,
  index = false,
  children,
}: {
  user: User;
  current: SettingsSection;
  // /settings itself: on a phone, the menu alone.
  index?: boolean;
  children: ReactNode;
}) {
  const [reminderClubs, sharing] = await Promise.all([reminderClubsFor(user.id), sharingFor(user)]);
  const name = shownName(user.displayName);

  return (
    <GlobalShell current="settings" wide>
      <OldAnchorRedirect base="/settings" moved={MOVED_SECTIONS} />
      <div className={`settings-layout ${index ? "is-index" : "is-sub"}`}>
        <nav className="settings-menu" aria-label="Settings">
          {index ? (
            <h1 className="h-display settings-title">Settings</h1>
          ) : (
            <p className="h-display settings-title" aria-hidden="true">
              Settings
            </p>
          )}
          <div className="card profile-card mt14">
            <span className="avatar large" aria-hidden="true">
              {initials(name)}
            </span>
            <div className="grow profile-text">
              <p className="flush profile-name">{name}</p>
              <p className="small muted flush profile-email">{user.email}</p>
            </div>
          </div>
          <div className="card mt14 menu-card">
            <MenuRow href="/settings/account" icon="account" title="Account" value="Display name, email" current={current === "account"} />
            <MenuRow
              href="/settings/reminders"
              icon="reminders"
              title="Reminders"
              value={remindersSummary(user.emailReminders, reminderClubs.filter((c) => c.muted).length)}
              current={current === "reminders"}
            />
            <MenuRow
              href="/settings/privacy"
              icon="privacy"
              title="Privacy & data"
              value={privacySummary(sharing ? sharing.sharingNow : null)}
              current={current === "privacy"}
            />
          </div>
          <div className="card mt14 sign-out-card">
            <form action={signOut}>
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
            <Link
              href="/settings/sign-out"
              className="row-link mt-1"
              aria-current={current === "sign-out" ? "page" : undefined}
            >
              <span className="grow row-link-label">Sign out everywhere</span>
              <span className="row-link-chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          </div>
          <p className="mt20 delete-link-row">
            <Link
              href="/settings/delete-account"
              className="tap danger-link"
              aria-current={current === "delete" ? "page" : undefined}
            >
              Delete my account…
            </Link>
          </p>
        </nav>
        <div className="settings-page">
          {!index && (
            <p className="small flush settings-back">
              <Link href="/settings" className="tap back-link">
                <span aria-hidden="true">←</span> Settings
              </Link>
            </p>
          )}
          {children}
        </div>
      </div>
    </GlobalShell>
  );
}
