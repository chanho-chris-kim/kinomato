import type { ReactNode } from "react";
import { getSessionUserId } from "@/app/session";
import { GlobalShell, PublicShell } from "@/app/shell";
import type { LegalDocument } from "@/lib/legal";

// The frame for /terms and /privacy (docs/onboarding-spec.md §11.1):
// public, in the public shell signed out and the global shell signed in
// (no section current), with a prominent draft notice while the text awaits
// legal review. Nothing third-party loads here.
export async function LegalPage({
  title,
  document,
  children,
}: {
  title: string;
  document: LegalDocument;
  children: ReactNode;
}) {
  const content = (
    <main className="landing legal" style={{ maxWidth: 680 }}>
      <h1 className="h-display" style={{ fontSize: 30 }}>
        {title}
      </h1>
      <p className="small muted" style={{ margin: "6px 0 0" }}>
        Version <span className="legal-version">{document.version}</span> · dated{" "}
        {new Date(`${document.version}T00:00:00Z`).toLocaleDateString("en-CA", {
          timeZone: "UTC",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      {document.draft && (
        <div className="note mt20 legal-draft" role="note">
          <p className="small" style={{ margin: 0 }}>
            <strong>Draft — not yet reviewed.</strong> This page is a placeholder until a lawyer
            has reviewed it.
          </p>
        </div>
      )}
      {children}
    </main>
  );
  // Signed in or out, the page is the same; only the chrome differs.
  return (await getSessionUserId()) ? (
    <GlobalShell current={null}>{content}</GlobalShell>
  ) : (
    <PublicShell>{content}</PublicShell>
  );
}

// A heading with one line saying its text is pending review. No legal
// prose until it's been written and reviewed.
export function PendingSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="mt20">
      <h2 className="sec">{title}</h2>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        Text pending legal review.
      </p>
      {children}
    </section>
  );
}
