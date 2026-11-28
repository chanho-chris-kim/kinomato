import { requireUser } from "@/app/auth";
import { AccountSection, type AccountParams } from "../accountSection";
import { SettingsFrame } from "../settingsFrame";

// Account (u7): display name and email.
export default async function AccountPage({ searchParams }: { searchParams: Promise<AccountParams> }) {
  const params = await searchParams;
  const user = await requireUser("/settings/account");
  return (
    <SettingsFrame user={user} current="account">
      <AccountSection user={user} params={params} heading="h1" />
    </SettingsFrame>
  );
}
