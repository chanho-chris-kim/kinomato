import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { loadDataExport } from "@/app/dataExport";
import { exportFilename } from "@/lib/dataExport";

// Download my data (docs/onboarding-spec.md §11.5): GET, no query
// parameters, behind the same gate as every signed-in page (signed in,
// with current consent). The file is your own data only (app/dataExport.ts).
export async function GET() {
  const user = await requireUser("/settings");
  const now = new Date();
  const data = await loadDataExport(getDb(), user.id, now);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
