import { requireUser } from "@/app/auth";
import { signOutEverywhere } from "../actions";
import { SettingsFrame } from "../settingsFrame";

// Sign out everywhere (§4.4; u7 gives it its own page). Plain Sign out is
// the menu's button.
export default async function SignOutEverywherePage() {
  const user = await requireUser("/settings/sign-out");
  return (
    <SettingsFrame user={user} current="sign-out">
      <h1 className="h-display page-title">Sign out everywhere</h1>
      <section className="card mt14">
        <p className="small muted flush">
          Signs out every device and browser you&apos;re signed in on, this one included.
        </p>
        <form action={signOutEverywhere} className="mt14">
          <button type="submit" className="btn">
            Sign out everywhere
          </button>
        </form>
      </section>
    </SettingsFrame>
  );
}
