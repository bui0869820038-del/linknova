# LinkNova — Traffic Monetization Platform

A working full-stack starter for a traffic monetization SaaS concept. Includes member accounts, short links, click tracking, file upload/unlock, referral tracking, wallet ledger, payout requests, and an admin console.

## Requirements
- Node.js 22 LTS recommended (Node.js 18 or newer)
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and change `SESSION_SECRET` and the admin password.
5. Start:
   ```bash
   npm start
   ```
6. Visit http://localhost:3000

When updating an existing installation, keep `.env`, `linknova.sqlite`, `sessions.sqlite`, and the `uploads/` folder. Replace the application files only.

## First admin login
Defaults (change these before running outside a local demo):
- Email: `admin@linknova.local`
- Password: `ChangeMe123!`

The admin account is seeded on first startup using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

## What's implemented
- Responsive sign-in and registration
- Password hashing with bcrypt
- SQLite persistence for users, links, click events, uploaded files, referrals, payouts and settings
- Three link modes: direct share (no interstitial), long ad-style demo flow (two timed steps, 15 seconds total), and short ad-style demo flow (5-second countdown)
- Each link stores its own `link_type`; existing records are migrated automatically (old direct links remain direct, old interstitial links become short ad-style links)
- Duplicate-click suppression per IP hash per link per hour
- File upload and session-gated download flow
- Referral URL plus manual referral-code entry during registration
- One-level referral commissions: default 10% of referred member net ad revenue, for 365 days from referral signup
- Authenticated, idempotent server-to-server ad revenue callback; commissions remain pending until admin approval
- Admin review of pending referral commissions and configurable rate / reward period
- Wallet balance and payout request ledger
- Admin payout review and basic platform settings
- Basic API rate limiting, security headers, upload size limit

## Important production checklist
This project is a functional starter, not a finished financial or advertising business. The two ad-style interstitials are placeholders. They do **not** serve paid ads, calculate revenue from views or tasks, or transfer funds. Do not ask visitors to click fake ads or perform fake ad tasks. Never present demo CPM or demo balance as actual earnings.

Before public launch:
1. Integrate an ad provider that explicitly permits this traffic and interstitial format. Respect its policies, consent requirements, and invalid-traffic rules.
2. Implement verified server-to-server conversion callbacks. Credit earnings only after confirmed provider events; do not credit from a browser redirect or client-side click.
3. Integrate a regulated payment provider and webhook verification. Add KYC/tax workflows where required.
4. Add CSRF protection, email verification, password reset, stronger session configuration, audit logs, backups, malware scanning, file type allowlists, object storage, retention limits, and abuse reporting.
5. Add country-level analytics using a compliant GeoIP source. Current build labels country as Unknown.
6. Configure HTTPS, reverse proxy, secure cookies, environment secrets, monitoring and database backups.
7. Review local law, privacy policy, terms, copyright, data protection and consumer rules before operating.

## Link types

The link creator offers three distinct types:

1. `direct` — sends visitors straight to the destination without an interstitial page.
2. `ad_long` — shows a demo two-step waiting page (15 seconds total) before the destination.
3. `ad_short` — shows a demo short waiting page (5 seconds) before the destination.

The two ad-style pages are currently visual placeholders only. They do not display paid advertisements, count paid impressions, ask visitors to click fake ads, or create earnings. A compliant ad provider must be integrated before any real advertising revenue can be recognized. Existing databases are migrated automatically without deleting link records.

## Referral commission rules
The default program is one level only. A member may enter a referral code at registration or arrive through `/?ref=CODE`; a valid referral is attached to that new account once. The code is optional, but an invalid code is rejected so it is not silently ignored.

- Default commission: **10%** of the referred member's verified net ad revenue.
- Reward window: **365 days** from referral signup.
- No reward is earned merely for a signup, click, demo interstitial or file download.
- Only an authenticated server-to-server event from an approved ad provider can create a pending commission. Repeated provider event IDs are ignored.
- Pending commissions must be reviewed by an administrator before they are credited to the referrer's wallet.
- Admin can change the rate (0–30%) and reward period (1–730 days). New settings apply to future revenue events, not historical commissions.
- No multi-level rewards. Fake accounts, self-referrals, incentivized/automated traffic, invalid traffic and provider clawbacks are excluded by program policy. The starter records referral attribution but cannot reliably identify a person operating multiple accounts; stronger email / identity verification and fraud controls are still required before launch.

### Connect an ad provider
Add a long random value to `.env` as `AD_REVENUE_WEBHOOK_SECRET`. Configure the approved provider's server-to-server callback adapter to send the following JSON to `POST /api/webhooks/ad-revenue` with `Authorization: Bearer <secret>` over HTTPS:

```json
{
  "event_id": "unique-provider-event-id",
  "publisher_user_id": 123,
  "net_revenue_usd": 4.25,
  "currency": "USD"
}
```

`net_revenue_usd` must be the provider-confirmed net amount attributable to the referred publisher, not an estimate based on clicks. The endpoint stores a unique event and creates a pending commission; an administrator then approves or rejects it. No ad network is connected in this starter, so the endpoint does not generate events by itself.

## API overview
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/dashboard`
- `GET/POST /api/links`, `DELETE /api/links/:id`
- `GET/POST /api/files`, `POST /api/files/:id/unlock`
- `GET /api/referrals`
- `POST /api/webhooks/ad-revenue` (authenticated ad-provider callback)
- `POST /api/admin/referral-commissions/:id/status` (approve / reject pending commission)
- `POST /api/payouts`
- Admin: `GET /api/admin/overview`, `POST /api/admin/payouts/:id/status`, `POST /api/admin/settings`
- `GET /api/health`

## Notes
- SQLite database and uploads are created automatically at runtime.
- For a public multi-instance deployment, move from SQLite/local uploads to managed database and object storage.
- This starter intentionally avoids fake earnings and fake ad impressions.
