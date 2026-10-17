# Import a society's members from a spreadsheet

Oct 2026. **Status: built on branch `society-csv-invites`. Needs migration 0170 applied, the PR merged (Vercel deploys the website), then `eas update` for the app's link handling. No native build.**

A society moving onto PinPals already has its member list. The captain or secretary uploads it on the website and every address gets an email. Each person is in the society as soon as they sign in to PinPals with that email — no Join button.

## Where

Society admin (pinpals.ie/society) → **Members → Import from spreadsheet** (also a button on Members & requests). Owner, captain and secretary only (`society_can(..., 'people')`).

1. **Your member list** — choose a `.csv` or paste addresses. The browser reads it and shows exactly who will be invited, which rows are skipped (no valid email, duplicate) and why. Up to 500 per import. A sample CSV downloads from the page. `.xlsx` files get a "save as CSV" message.
2. **Invitations sent** — Waiting / Joined / Cancelled, when each was emailed and how often, any reason someone couldn't be added. Resend one, Resend to all waiting (at most once an hour per person), or Cancel (the link stops working).

The CSV reader (`src/lib/society-console/member-import.ts`) handles Excel/Sheets/Numbers exports: comma, semicolon or tab; quotes; BOM; header or no header. Columns are found by name — Email / E-mail address, First name / Forename, Surname / Last name, or a single Name ("Jane Byrne" or "Byrne, Jane"). Without a header, the column full of @s is the email.

## How someone ends up in the society

| They are… | What happens |
| --- | --- |
| Already on PinPals with that email (confirmed) | Added at import. Emailed "You're now in X" — they can Leave. |
| New to PinPals | Emailed "Join X on PinPals". The moment their account's email is confirmed — signed up on the website or in the app — they're in (trigger on `auth.users`). |
| Signing up with a different email | The email's button (`/join/s/<token>`) still works: opened signed in, or signed in after opening it, it adds that account. One use. |

Joining always goes through `group_add_member()`, so capacity (500), blocks against the committee and the junior rules (0159) still apply. A refusal is kept on the invite as `failure` and shown in the list; it never stops a sign-up.

## Pieces

- `supabase/migrations/0170_society_email_invites.sql` — `group_email_invites` (committee can read every column but `token`; no direct writes), `import_group_email_invites`, `resend_group_email_invites`, `mark_group_email_invites_sent`, `cancel_group_email_invite`, `group_email_invite_preview` (anon — the link's front page), `claim_group_email_invite`, and the `on_auth_user_email_invites` trigger.
- `src/app/society/[id]/members/import/` — the page, the upload/preview form, the actions (import, resend, cancel).
- `src/lib/society-invite-email.ts` — the branded email (same look as the sign-up emails, with the society's logo). Sent through Resend's **batch** endpoint (`sendEmailBatch` in `src/lib/email.ts`), 100 per request.
- `src/app/join/s/[token]/` — the email's landing page. Signed out it keeps the token in a cookie (`pp_email_invite`, claimed by the middleware after sign-in) and opens sign-up with the address filled in (`/signup?email=`).
- App: `/join/s/<token>` opens the existing join screen (`mobile/src/app/join-group.tsx`, `?token=`); signed out it's remembered and claimed after sign-in like a group link. Guides "Set up a society" and "Join a society" mention the import.

## Before using it with a big list

- **Resend's free plan sends 100 emails a day (3,000 a month).** A 150-member society needs the Pro plan ($20 a month, 50,000 emails), or import in batches on different days — anything that didn't send shows "Not sent" and can be resent.
- `RESEND_API_KEY` and the verified `pinpals.ie` domain are already what notification and sign-up emails use.

## Verified

RLS suite 1023/1023 (10 new in `society-email-invites.test.ts`, grants listed in `function-grants.test.ts`); site unit tests 1861 (16 new for the CSV reader and emails); site and app `tsc`; guide test.
