# Switching email from Brevo to Amazon SES (manual cutover)

Ruled 2026-11-22 (CLAUDE.md Stack; onboarding-spec §9): every email is sent
through Amazon SES in **ca-central-1** with **no open or click tracking**.
SES only adds a tracking pixel or rewrites links through a *configuration
set*; `lib/email.ts` never names one, and `lib/email.test.ts` pins that.

Merging the `e1-ses` branch before the SES secrets exist on the Worker
breaks sign-in email in production (the code fails loud without them). So
the order below matters. Do it between movie nights.

## 1. SES identity for kinomato.com (AWS console, region ca-central-1)

1. SES → **Identities** → **Create identity** → Domain → `kinomato.com`.
   Use **Easy DKIM**, RSA 2048-bit.
2. In Cloudflare DNS, add the **three DKIM CNAMEs** SES shows
   (`<token>._domainkey.kinomato.com → <token>.dkim.amazonses.com`), each
   **DNS only (grey cloud), not proxied**. Wait for "Verified".
3. **Custom MAIL FROM domain**: `mail.kinomato.com`. In Cloudflare add:
   - MX `mail.kinomato.com` → `feedback-smtp.ca-central-1.amazonses.com`,
     priority 10;
   - TXT `mail.kinomato.com` → `"v=spf1 include:amazonses.com ~all"`.
4. **DMARC**: if `_dmarc.kinomato.com` doesn't exist, add TXT
   `"v=DMARC1; p=none; rua=mailto:<your address>"`. Tighten to
   `p=quarantine` once a few weeks of reports look clean.
5. **No configuration set, anywhere.** Don't create one. Check the identity
   has **no default configuration set** attached (one would apply even
   when a request names none):
   SES → Identities → kinomato.com → **Configuration set** section shows
   none (or `aws sesv2 get-email-identity --email-identity kinomato.com
   --region ca-central-1` has no `ConfigurationSetName`).
6. **Suppression list**: SES → Configuration → Suppression list →
   account-level, both Bounces and Complaints (the default for accounts
   created after 2019-11-25; confirm it).
7. **Production access**: SES → Account dashboard → **Request production
   access**. Transactional email for a private app: sign-in codes, account
   notices, a few reminders a week, no marketing, bounces suppressed. Until
   it's approved the account is in the sandbox (200 a day, verified
   recipients only).

## 2. An IAM user that can only send as hello@kinomato.com

IAM → Users → create `kinomato-ses-sender` (no console access), with this
inline policy (replace `<account-id>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:ca-central-1:<account-id>:identity/kinomato.com",
      "Condition": {
        "StringEquals": { "ses:FromAddress": "hello@kinomato.com" }
      }
    }
  ]
}
```

Create an **access key** for it (use case: application running outside
AWS). Don't paste it anywhere but the next step.

## 3. Worker secrets (before merging)

Only when the latest uploaded Worker version is the deployed one
(CLAUDE.md: never edit secrets in the dashboard):

```
npx wrangler secret put SES_ACCESS_KEY_ID
npx wrangler secret put SES_SECRET_ACCESS_KEY
npx wrangler secret put SES_REGION      # ca-central-1
```

The running (Brevo) code ignores them, so this is safe ahead of the merge.
Leave `BREVO_API_KEY` in place for now: it's the rollback.

## 4. Merge and check

1. Merge `e1-ses`; wait for Workers Builds to deploy `dev.kinomato.com`.
2. Sign out, sign in with your own address. You'll also be asked to accept
   the new Privacy version (2026-11-22): that's expected.
3. Open the email's **raw source** ("Show original" in Gmail) and confirm:
   - no `<img>` tracking pixel (the email has no images at all);
   - no `awstrack.me` anywhere; the sign-in link points straight at
     `https://dev.kinomato.com/verify?token=…`;
   - `Authentication-Results`: `dkim=pass` with `header.d=kinomato.com`,
     `spf=pass` (for `mail.kinomato.com`), `dmarc=pass`.
4. Trigger an ops alert only if you want to see one (not needed).

**Rollback** before step 5: revert the merge on `main`. Brevo's key and DNS
are still there, so email works again on the next deploy.

## 5. Only then: remove Brevo

1. `npx wrangler secret delete BREVO_API_KEY` (same rule as step 3).
2. In Cloudflare DNS, delete Brevo's records: its DKIM record(s) (Brevo's
   `_domainkey` entries), the `brevo-code` TXT, and `include:spf.brevo.com`
   from the root SPF record (remove the whole root SPF record if Brevo was
   its only include).
3. In Brevo, delete the contacts it collected and close the account, or ask
   Brevo to delete the account's data. Note the date for the Privacy text.
