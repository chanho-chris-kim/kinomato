import { getDb } from "@/db";
import { stopAllRemindersByToken } from "@/app/reminderUnsubscribe";
import { isUnsubscribeTokenShaped } from "@/lib/reminderPrefs";

// One-click unsubscribe (RFC 8058, ruled 2026-11-23): every reminder's
// List-Unsubscribe header points here, with List-Unsubscribe-Post. A mail
// app's "Unsubscribe" POSTs "List-Unsubscribe=One-Click" and that stops all
// of this person's reminder emails, with no confirmation page. A browser
// opening the URL (GET) is sent to the two-button page and nothing changes:
// email scanners open links. Public, no session, no consent gate; the token
// is the only credential (app/reminderUnsubscribe.ts).

const ONE_CLICK = /(^|&)List-Unsubscribe=One-Click(&|$)/;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.text();
  if (!ONE_CLICK.test(body)) return new Response(null, { status: 400 });
  const done = await stopAllRemindersByToken(getDb(), token, new Date());
  return new Response(null, { status: done ? 200 : 404 });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = isUnsubscribeTokenShaped(token) ? `/unsubscribe/${token}` : "/unsubscribe/expired";
  return Response.redirect(new URL(page, request.url), 303);
}
