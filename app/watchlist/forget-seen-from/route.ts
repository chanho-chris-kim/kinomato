import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/app/auth";
import { RETIRED_SEEN_FROM_COOKIE } from "../seenFromCookie";

// Where /watchlist sends an old ?seen= link, or a browser still holding the
// retired Seen from cookie (removed 2026-11-24): a page can't change
// cookies, so this deletes it, on the path it was set with, and goes back
// to plain /watchlist, keeping the search. Changes nothing else.
export async function GET(request: NextRequest) {
  await requireUser("/watchlist");
  const q = request.nextUrl.searchParams.get("q")?.trim();
  const target = new URL(q ? `/watchlist?${new URLSearchParams({ q })}` : "/watchlist", request.url);
  const response = NextResponse.redirect(target, 303);
  // On /watchlist, where it was set, and on /, the only other path a cookie
  // sent to /watchlist can have: once both are gone, /watchlist can't send
  // anyone back here.
  for (const path of ["/watchlist", "/"]) {
    response.headers.append(
      "Set-Cookie",
      `${RETIRED_SEEN_FROM_COOKIE}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
  }
  return response;
}
