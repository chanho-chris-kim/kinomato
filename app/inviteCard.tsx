// "{inviter} invited you to {club}", on every step of an invited sign-up
// (u3, §5.13): the invite stays in view. Only what the invite landing
// already shows.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0])
    .join("")
    .toUpperCase();
}

export function InviteCard({ inviterName, clubName }: { inviterName: string; clubName: string }) {
  return (
    <div className="card row gap10 mt14 invite-card">
      <span className="avatar" aria-hidden="true">
        {initials(inviterName)}
      </span>
      <p className="small flush">
        <strong>{inviterName}</strong> invited you to <strong>{clubName}</strong>
      </p>
    </div>
  );
}
