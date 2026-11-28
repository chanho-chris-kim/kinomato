import { requireUser } from "@/app/auth";
import { AccountSection, type AccountParams } from "./accountSection";
import { SettingsFrame } from "./settingsFrame";

// Settings (u7, ruled 2026-11-27; what's in it, docs/onboarding-spec.md
// §5.9): on a phone, the profile and the menu; from 900px the menu on the
// left and Account beside it. Nothing goes here until it's built — no
// "coming soon".
export default async function SettingsPage({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const params = await searchParams;
  const user = await requireUser("/settings");
  return (
    <SettingsFrame user={user} current="account" index>
      <AccountSection user={user} params={params} heading="h2" />
    </SettingsFrame>
  );
}
