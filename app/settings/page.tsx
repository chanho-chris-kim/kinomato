import { requireUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { signOut } from "./actions";

// Settings ships in rebuild step 5a with Sign out only
// (docs/onboarding-spec.md §8.5); the rest of §5.9 is step 7. Nothing
// else goes here until it's built — no "coming soon".
export default async function SettingsPage() {
  await requireUser("/settings");
  return (
    <GlobalShell current="settings">
      <h1 className="h-display" style={{ fontSize: 22 }}>
        Settings
      </h1>
      <form action={signOut} className="mt20">
        <button type="submit" className="btn">
          Sign out
        </button>
      </form>
    </GlobalShell>
  );
}
