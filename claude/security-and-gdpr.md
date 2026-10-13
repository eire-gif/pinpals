# Security and GDPR — what's in place, and the records behind it

13 October 2026. Branch `privacy-hardening`. Migrations 0133, 0134, 0135.
Privacy Policy 1.1 is on `legal-zero-tolerance` (PR #103).

Not reviewed by a solicitor or a data protection adviser. It should be, before launch.

---

## 1. What changed

| Area | Before | Now |
|---|---|---|
| Handicap | Readable by every signed-in member through the API, even when "hidden" — the app just didn't show it | Real value in `member_private`, readable only by the member. The copy on `profiles` holds it only while the member shows it. Society officers still see it (`society_handicaps`, as promised on joining) and the handicap indicator still uses it |
| Golf Ireland number | Readable by every signed-in member | In `member_private` only. The copy on `profiles` is always blank |
| Mobile numbers | Not collected | Optional, verified by a text code (Supabase Auth). Copied to `member_phones` (owner-only) by a trigger once Auth confirms it |
| Society contacts | None | Per-group, member's own choice (`member_phone_shares`). `group_contacts()`: the people who run a group see members' shared numbers; members see the people who run it. App: group page → **Phone numbers** (Call / Text / WhatsApp) |
| Sign-in | Email + password | Also **Sign in with a text code** (app and website), for verified mobiles only. Never creates an account |
| Staff | Password only | **Two-step sign-in** (authenticator app). `/admin` sends staff to `/two-step`. 0135 makes the database agree: `is_staff()` is true only on an aal2 session |
| Right of access | Email us | **Download my data** — app (Privacy & security) and website (`/profile/privacy`). JSON file of every table naming the member, secrets and staff notes removed |
| Account deletion | Profile anonymised | Also deletes `member_private`, the mobile (Auth too) and every share |
| Database hygiene | 3 trigger functions callable by anyone; 7 functions with a mutable search path | Revoked; search paths pinned |

Older apps keep working: writing `handicap` or `gui_membership_number` on `profiles` the old way moves the value into `member_private`.

---

## 2. To do, in order

1. **Paste the SQL** (Supabase → SQL editor), one file at a time: `0133_privacy_hardening.paste.sql`, then `0134_member_phones.paste.sql`. **Not 0135 yet.**
2. **Merge the PR**, wait for Vercel to show Ready, then `eas update --branch production --platform ios`.
3. **Two-step for staff.** Both super admins sign in on the website and open `/admin`. It sends you to `/two-step`: scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), type the code. Then paste `0135_staff_two_step.paste.sql`. (Before that, the database still treats a password-only staff session as staff; after it, it doesn't.)
4. **Leaked-password protection.** Supabase → Authentication → (Attack Protection / Password security) → turn on *Prevent use of leaked passwords*. Pro plan feature.
5. **Text messages.** Supabase → Authentication → Sign In / Providers → **Phone** → enable, provider **Twilio** (Account SID, Auth Token, Messaging Service SID). Code length 6, expiry 5–10 minutes.
   - Twilio → Messaging → Geo permissions: **Ireland and UK only**. This is the main defence against SMS-pumping fraud.
   - Supabase → Authentication → Rate limits: SMS per hour around 30 to start.
   - Until this is set up, "Text me a code" says "We can't send text messages just now" — nothing breaks.
   - Phone signup: the app and site never create an account from a phone (`shouldCreateUser: false`), but the Auth API would if called directly with phone enabled. A phone-only account would have a blank profile and no email. If Supabase offers a separate phone-signup switch, turn it off; otherwise accept it and watch Users for phone-only rows.
6. **App Store privacy answers** (see §8) — update before the next submission.

---

## 3. Records of processing (Article 30)

Controller: the PinPals company (details in `src/lib/legal/operator.ts` on #103). Contact: privacy@pinpals.ie. No DPO required.

| Activity | Data | Who | Basis | Kept | Shared with |
|---|---|---|---|---|---|
| Accounts and profiles | Name, email, password hash, club, county, bio, photo, age band, handicap, Golf Ireland no. | Members | Contract; consent for showing handicap and age band | Life of account | Supabase |
| Verified mobile, text-code sign-in | Mobile number, codes | Members who add one | Contract (they asked) | Until removed or account closed | Supabase, Twilio |
| Sharing a mobile with a group | Number, which groups | Members who opt in | Consent, per group | Until switched off, left, or number removed | Group's owner/admins (and members, for numbers of those who run it) |
| Groups, societies, events | Membership, roles, entries, guests, payments marked, society handicaps | Members | Contract | Life of group / account | Supabase |
| Live scoring, scorecards, handicap indicator | Scores, rounds, shot positions (lat/lng on a course) | Members who play | Contract | Life of account, or until round deleted | Round's players |
| Location (nearby, hole map) | Phone's position | Members who allow it | Consent (phone permission) | Nearby: not kept. Hole map: only as a marked shot | Not shared |
| Marketplace | Listings, offers, bids, orders, addresses, payouts | Buyers, sellers | Contract; legal obligation (records) | Orders/payments 6 years | Stripe, Supabase |
| Messages and Social | Messages, posts, comments, photos | Members | Contract | Life of account | Supabase |
| Notifications | Email, push token | Members | Contract; consent for newsletter | Life of account | Resend, Expo/Apple/Google |
| Safety and moderation | Reports, blocks, fraud flags, staff notes, audit log | Members, staff | Legitimate interest | Up to 6 years | Supabase |
| Consent records | Document versions accepted, IP, user agent | Members | Legal obligation (Art. 7(1)) | Life of account | Supabase |

## 4. Processors

| Processor | Purpose | Where | Agreement to check |
|---|---|---|---|
| Supabase | Database, auth, storage | EU (Ireland, eu-west-1) | Supabase DPA (sign in dashboard) |
| Vercel | Website hosting, logs | Global edge; US company | Vercel DPA, SCCs |
| Stripe | Payments, payouts | EU/US | Stripe DPA (in its terms); Stripe is its own controller for some processing |
| Resend | Email | US | Resend DPA, SCCs |
| Twilio | Text-message codes | US/global | Twilio DPA, SCCs |
| Expo (+ Apple APNs, Google FCM) | Push notifications | US | Expo DPA |
| Google Maps Platform | Satellite tiles on hole maps | Global | Google Maps Platform terms + data processing terms |
| Anthropic | Drafting golf news from public sources — no member data | US | Commercial terms |

Keep a copy of each signed/accepted DPA in the company records.

## 5. If there is a breach

1. **Contain** — revoke the key or session, disable the account, take the page down. Supabase: rotate the service role key and JWT secret if they could be exposed; Vercel: rotate env vars.
2. **Record** it (what, when, whose data, how many) — even if it isn't reportable. Article 33(5).
3. **Assess** within 24 hours: is it likely to be a risk to people? A leaked mobile number list, messages, addresses or location history: yes.
4. **Tell the Data Protection Commission within 72 hours** of becoming aware, if there's a risk — dataprotection.ie breach form. Send what you know; add the rest later.
5. **Tell the members affected** without undue delay if the risk is high (e.g. passwords, mobiles with names, addresses, messages): what happened, what it means, what to do.
6. Fix the cause, then write it up in `claude/incident-*.md` as before.

## 6. Location — risk check (DPIA screening)

- **What:** the phone's position for (a) "near me" tee times — sent with one search, not stored; (b) the hole map — distances shown on the phone; a position is stored only when the member taps to mark a shot (`live_round_shots`, lat/lng with accuracy).
- **Who sees stored positions:** the players in that round only (`can_view_live_round`). Points on a golf course during a round — not a home or a route.
- **Risks:** showing when someone is at a course; a shared round with someone they don't know. **Mitigations:** no background tracking, permission asked when used, no positions outside marked shots, deleted with the account, round players only.
- **Conclusion:** not high-risk processing; a full DPIA isn't required. Revisit if location is ever kept outside a marked shot, shown to people not in the round, or tracked in the background.

## 7. Retention

| Data | Kept |
|---|---|
| Account, profile, posts, messages, groups, rounds | Life of account; removed or anonymised on deletion (30-day grace) |
| Mobile number | Until removed, or account closed |
| Orders, payments, refunds, commission | 6 years from end of tax year |
| Reports, suspensions, dispute outcomes | Up to 6 years |
| Consent records | Life of account |
| Hosting logs | Days to weeks (provider settings) |

## 8. App Store privacy answers — changes

- **Contact Info → Phone Number:** App Functionality, linked. Now "an optional verified mobile, used to sign in and shared with groups the member chooses".
- **Location → Precise Location: now tick it.** Shot positions from the hole map are stored with the round. App Functionality, linked, not tracking. (The old note in `app-store-privacy-answers.md` says location isn't stored — that changed with hole maps, 0108.)
- **Other Data:** add "group memberships, live scores and scorecards".

## 9. Sign in with Apple and Google (not built — when you want them)

App Store rule 4.8: if the app offers Google (or any third-party) sign-in, it must also offer Sign in with Apple. Both need a new native build (not an OTA).

**Apple**
1. developer.apple.com → Identifiers → the app's App ID → enable *Sign in with Apple*.
2. Create a **Services ID** (for the website), set the domain `pinpals.ie` and return URL `https://cicluiabimxklgmpmxmn.supabase.co/auth/v1/callback`.
3. Keys → create a key with *Sign in with Apple*; download the .p8, note Key ID and Team ID.
4. Supabase → Authentication → Providers → **Apple**: Services ID, Team ID, Key ID, the .p8 contents (generates the secret; it expires every 6 months — calendar it).
5. App: `expo-apple-authentication`, then `supabase.auth.signInWithIdToken({ provider: "apple", token })`. Needs `ios.usesAppleSignIn: true` in app config → native build.

**Google**
1. Google Cloud console → OAuth consent screen (External, app name, privacy policy URL).
2. Credentials → OAuth client IDs: one **Web** (redirect `https://cicluiabimxklgmpmxmn.supabase.co/auth/v1/callback`), one **iOS** (bundle ID), one **Android** (package + SHA-1).
3. Supabase → Authentication → Providers → **Google**: Web client ID + secret; add the iOS/Android client IDs to *Authorized Client IDs*.
4. App: `@react-native-google-signin/google-signin` → `signInWithIdToken({ provider: "google", token })` → native build.

Watch-outs: Apple may give a private relay email; a Google/Apple account with the same email as an existing member links to it only if Supabase *Manual/automatic linking* is set — decide before launch. New social accounts skip the sign-up consent screen unless the app sends them through it.

## 10. Still open

- Privacy Policy 1.1 goes live only with #103 (needs the company details). #103 also has an older, unverified "mobile at sign-up" field (`member_private_details`, its own `src/lib/phone.ts`) — when it's rebased, drop that field in favour of the verified flow here.
- `is_staff()` with aal2 means staff on the app are members until they open Admin on the website. Intended.
- SMS costs money per code — keep geo permissions tight and watch the Twilio bill in the first weeks.
- Get a solicitor to read the Privacy Policy and this record before launch.
