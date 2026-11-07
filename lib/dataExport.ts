// Download my data (docs/onboarding-spec.md §11.5): the shape of the file,
// as a pure function over rows already scoped to one person. Every field
// is copied by name, so a column a query happens to select (a hash, a
// token, someone else's id) never reaches the file. The rows come from
// app/dataExport.ts, through the modules that own each table.

export const EXPORT_FORMAT_VERSION = 1;

type When = Date | null;

export interface ExportInput {
  account: { email: string; displayName: string | null; createdAt: Date; ageBracket: string | null; ageAttestedAt: When };
  consentEvents: { document: string; version: string; acceptedAt: Date; method: string }[];
  licensing: { wordingVersion: string; optedInAt: Date; withdrawnAt: When }[];
  clubs: { name: string; role: string; joinedAt: Date; leftAt: When }[];
  watchlist: { title: string; year: number; addedAt: Date; note: string | null; tags: string[] }[];
  ratings: {
    clubName: string;
    filmTitle: string | null;
    nightAt: Date;
    scoreQuality: string;
    scoreFun: string;
    hotTake: string | null;
    tags: string[];
  }[];
  nominations: { clubName: string; filmTitle: string; nightAt: Date }[];
  rsvps: { clubName: string; nightAt: Date; status: string | null }[];
  constraints: {
    clubName: string;
    kind: string;
    ruleType: string;
    value: string;
    label: string | null;
    appliesWhenAbsent: boolean;
  }[];
  votes: { clubName: string; nightAt: Date; filmTitle: string; castAt: Date }[];
  vetoes: { clubName: string; nightAt: Date; filmTitle: string; castAt: Date }[];
  emailChanges: { newEmail: string; requestedAt: Date; confirmedAt: When; cancelledAt: When }[];
}

const iso = (d: When) => (d ? d.toISOString() : null);
const oldestFirst = <T>(rows: T[], at: (row: T) => Date) =>
  [...rows].sort((a, b) => at(a).getTime() - at(b).getTime());

// kinomato-export-2026-11-07.json, by the UTC date it was made.
export function exportFilename(now: Date): string {
  return `kinomato-export-${now.toISOString().slice(0, 10)}.json`;
}

export function shapeExport(input: ExportInput, now: Date) {
  const { account } = input;
  return {
    meta: { format_version: EXPORT_FORMAT_VERSION, generated_at: now.toISOString() },
    account: {
      email: account.email,
      display_name: account.displayName,
      created_at: iso(account.createdAt),
      age_bracket: account.ageBracket,
      age_attested_at: iso(account.ageAttestedAt),
    },
    consent: {
      documents: oldestFirst(input.consentEvents, (e) => e.acceptedAt).map((e) => ({
        document: e.document,
        version: e.version,
        accepted_at: iso(e.acceptedAt),
        method: e.method,
      })),
      data_licensing: oldestFirst(input.licensing, (l) => l.optedInAt).map((l) => ({
        wording_version: l.wordingVersion,
        opted_in_at: iso(l.optedInAt),
        withdrawn_at: iso(l.withdrawnAt),
      })),
    },
    clubs: oldestFirst(input.clubs, (c) => c.joinedAt).map((c) => ({
      name: c.name,
      role: c.role,
      joined_at: iso(c.joinedAt),
      left_at: iso(c.leftAt),
    })),
    watchlist: oldestFirst(input.watchlist, (w) => w.addedAt).map((w) => ({
      film: w.title,
      year: w.year,
      added_at: iso(w.addedAt),
      note: w.note,
      tags: [...w.tags],
    })),
    ratings: oldestFirst(input.ratings, (r) => r.nightAt).map((r) => ({
      club: r.clubName,
      film: r.filmTitle,
      night: iso(r.nightAt),
      quality: r.scoreQuality,
      fun: r.scoreFun,
      hot_take: r.hotTake,
      tags: [...r.tags],
    })),
    nominations: oldestFirst(input.nominations, (n) => n.nightAt).map((n) => ({
      club: n.clubName,
      film: n.filmTitle,
      night: iso(n.nightAt),
    })),
    rsvps: oldestFirst(input.rsvps, (r) => r.nightAt).map((r) => ({
      club: r.clubName,
      night: iso(r.nightAt),
      status: r.status,
    })),
    limits_and_preferences: input.constraints.map((c) => ({
      club: c.clubName,
      kind: c.kind,
      rule_type: c.ruleType,
      value: c.value,
      label: c.label,
      applies_when_absent: c.appliesWhenAbsent,
    })),
    votes: oldestFirst(input.votes, (v) => v.nightAt).map((v) => ({
      club: v.clubName,
      night: iso(v.nightAt),
      film: v.filmTitle,
      cast_at: iso(v.castAt),
    })),
    vetoes: oldestFirst(input.vetoes, (v) => v.nightAt).map((v) => ({
      club: v.clubName,
      night: iso(v.nightAt),
      film: v.filmTitle,
      cast_at: iso(v.castAt),
    })),
    email_change_requests: oldestFirst(input.emailChanges, (e) => e.requestedAt).map((e) => ({
      new_email: e.newEmail,
      requested_at: iso(e.requestedAt),
      confirmed_at: iso(e.confirmedAt),
      cancelled_at: iso(e.cancelledAt),
    })),
  };
}

export type DataExport = ReturnType<typeof shapeExport>;

// Every key path that looks like a credential (hash, token, code), at any
// depth. The export must have none; tests and the E2E check use this.
export function findSecretLikeKeys(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSecretLikeKeys(v, [...path, String(i)]));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(/hash|token|code/i.test(key) ? [[...path, key].join(".")] : []),
    ...findSecretLikeKeys(v, [...path, key]),
  ]);
}
