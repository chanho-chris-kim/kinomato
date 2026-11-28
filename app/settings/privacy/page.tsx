import { requireUser } from "@/app/auth";
import { currentLegal } from "@/lib/legal";
import { optInToLicensingAction, withdrawFromLicensingAction } from "../actions";
import { SettingsFrame, sharingFor } from "../settingsFrame";

// Privacy & data (u7): data sharing for 18 or older (§11.2; 13–17 never see
// it) and Download my data (§11.5), as on the single page before.
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ sharing?: string }> }) {
  const { sharing: sharingNotice } = await searchParams;
  const user = await requireUser("/settings/privacy");
  const sharing = await sharingFor(user);

  return (
    <SettingsFrame user={user} current="privacy">
      <h1 className="h-display page-title">Privacy &amp; data</h1>

      {sharing && (
        <section className="card mt14" aria-labelledby="data-sharing">
          <h2 id="data-sharing" className="sec flush">
            Data sharing
          </h2>
          {sharingNotice && (
            <p className="small mt-1 saved-note" role="status">
              {sharingNotice === "on" ? "You're sharing." : "Withdrawn."}
            </p>
          )}
          <p className="small mt-1 flush data-sharing-status">
            {sharing.sharingNow
              ? "You're sharing, in anonymous aggregates only."
              : sharing.licensing.status.withdrawnAt
                ? "You're not sharing. You withdrew, so nothing new of yours goes into an aggregate."
                : "You're not sharing."}
          </p>
          <p className="tiny dim mt-1 flush licensing-wording">{currentLegal().licensing.text}</p>
          {sharing.sharingNow ? (
            <>
              <form action={withdrawFromLicensingAction} className="mt14">
                <button type="submit" className="btn auto">
                  Withdraw
                </button>
              </form>
              <p className="tiny dim mt-1 flush">
                Withdrawing applies from now on: your data stops going into new aggregates, but ones already made
                can&apos;t be recalled.
              </p>
            </>
          ) : (
            <form action={optInToLicensingAction} className="mt14">
              <button type="submit" className="btn auto">
                Opt in
              </button>
            </form>
          )}
        </section>
      )}

      <section className="card mt14" aria-labelledby="your-data">
        <h2 id="your-data" className="sec flush">
          Your data
        </h2>
        <p className="small muted mt-1 flush">
          Everything Kinomato holds that&apos;s yours, as one JSON file: your account and reminder settings, clubs,
          watchlist, ratings, nominations, RSVPs, limits and preferences, and your own votes and vetoes. Never anyone
          else&apos;s.
        </p>
        {/* A plain link, not next/link: it's a file download from a route
            handler (app/settings/export/route.ts), never prefetched. */}
        <a href="/settings/export" download className="btn mt14 inline-block auto">
          Download my data
        </a>
      </section>
    </SettingsFrame>
  );
}
