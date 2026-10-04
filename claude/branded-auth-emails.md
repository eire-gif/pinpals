# Branded sign-up and account emails

October 2026. Replaces Supabase's default "Confirm your signup" email, sent from a generic Supabase address, with PinPals-branded emails sent from `@pinpals.ie`.

## Why it needs dashboard work

On Supabase's free plan the auth email templates are **locked until a custom SMTP sender is set** (see `password-reset-setup.md`). The site already sends notification emails through **Resend** (`src/lib/email.ts`, `RESEND_API_KEY`), so the same Resend account becomes Supabase Auth's SMTP sender. No new provider and no new code dependency.

## What's in the repo

| File | Supabase template | Subject | Link |
|---|---|---|---|
| `supabase/templates/confirm-signup.html` | Confirm sign up | Confirm your PinPals account | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` |
| `supabase/templates/reset-password.html` | Reset password | Reset your PinPals password | `{{ .ConfirmationURL }}` (the reset page signs in client-side; unchanged flow) |
| `supabase/templates/change-email.html` | Change email address | Confirm your new email for PinPals | `…/auth/confirm?token_hash=…&type=email_change&next=/dashboard` |
| `supabase/templates/magic-link.html` | Magic link | Your PinPals sign-in link | `…/auth/confirm?token_hash=…&type=email&next=/dashboard` |

All four share one layout: navy header with the PinPals mark and gold rule, cream background, a green pill button, the link spelled out under the button, and a footer. Fonts fall back to Georgia and the system sans, since email clients don't load web fonts reliably.

The confirmation email greets the member by first name (`{{ .Data.first_name }}`, from sign-up metadata) when there is one.

**The sign-up link changed on purpose.** The default email links through Supabase's verify endpoint, which lands on `/auth/confirm` with a PKCE `code`. The route only handled `token_hash`, so new members were confirmed but sent to `/login` with an error. The branded link uses `token_hash`, which the route verifies on our own domain: the member is signed in and goes straight to profile setup.

`src/app/auth/confirm/route.ts` now also handles `code`, so default-template emails already sitting in inboxes work. If such a link is opened in a different browser from the one that signed up, the member lands on `/login?confirmed=1` ("Your email is confirmed. Log in to get started.") instead of an error. `/login` also explains `confirm_error`.

## Setup steps (Eire)

1. **Resend: verify the domain.** In resend.com → Domains, add `pinpals.ie` and put the DNS records it shows (SPF/MX and DKIM) into the domain's DNS. Wait for **Verified**. If notification emails already arrive from `notifications@pinpals.ie`, this is already done.
2. **Resend: API key.** Create a key for Supabase (Sending access) and copy it.
3. **Supabase → pinpals project → Authentication → Emails → SMTP Settings → Enable custom SMTP:**
   - Sender email: `hello@pinpals.ie` (or `noreply@pinpals.ie`)
   - Sender name: `PinPals`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key from step 2
   - Save.
4. **Supabase → Authentication → Emails → Templates.** For each of the four templates above: set the **Subject** from the table, paste the whole HTML file into the message body, and save.
5. **Rate limit.** Authentication → Rate Limits: with custom SMTP, raise "emails sent per hour" from the low default (e.g. to 100).
6. **Test.** Sign up with a fresh address. The email should come from PinPals at `@pinpals.ie`, and the button should land you signed in on profile setup.

## Rolling back

Turn custom SMTP off in Supabase. Templates fall back to the defaults, and the `code` branch in `/auth/confirm` keeps those working.
