# UnifiedWorkforce on Netlify

Attendance, labelling productivity and meals for your company, with automatic email invitations. Everything runs on Netlify, with a free PostgreSQL database from Neon:

| Piece | Where it runs |
| --- | --- |
| The web app (attendance, meals, projects, ranking, reports, admin) | Netlify, as static files |
| Sign-in, saving records, invitations | A Netlify Function (`/api/*`) |
| Sending and retrying emails, and "book your meal" reminders | A scheduled Netlify Function, every minute |
| Your company's records | PostgreSQL (Neon) |

People sign in with their work email and a password. Nobody needs a Claude account.

Labelling work is counted automatically by the **UnifiedWorkforce for Labelbox** browser extension (the `extension` folder; see [Automatic Labelbox counting](#automatic-labelbox-counting)).

---

## Deploy it (about 20 minutes, no coding)

You'll need free accounts at **GitHub**, **Netlify** and **Neon**, and an email account that can send by SMTP.

### 1. Put the code on GitHub
1. Sign in at github.com, click **New repository**, name it `unified-workforce`, choose **Private**, and create it.
2. On the new repository page, click **uploading an existing file**.
3. Unzip `unified-workforce-netlify.zip`. Drag everything *inside* the `unified-workforce-netlify` folder into the browser, including the hidden `.gitignore` if you can see it. Click **Commit changes**.

### 2. Create the database
1. Sign in at neon.tech and create a project. Pick the region closest to your office (for Kenya, an EU region such as Frankfurt is a good choice).
2. On the project dashboard, click **Connect** and copy the **connection string**. It starts with `postgresql://` and ends with `?sslmode=require`. Keep it for step 4.

You don't need to create any tables; the system does that the first time it runs.

### 3. Create the Netlify site
1. Sign in at app.netlify.com. Click **Add new site > Import an existing project > GitHub**, and pick your `unified-workforce` repository.
2. Netlify reads the build settings from `netlify.toml`, so leave them as they are. Don't deploy yet: open **Site configuration** first, or let the first deploy run and fail; you'll redeploy after step 4.

### 4. Add the settings
In Netlify, open **Site configuration > Environment variables > Add a variable**, and add:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | the Neon connection string from step 2 |
| `JWT_SECRET` | a long random value. Use a password generator for 48+ characters, or run `openssl rand -base64 48` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | your email sending account (see **Email** below) |
| `MAIL_FROM` | e.g. `Acme Workforce <workforce@yourcompany.co.ke>` |
| `SETUP_TOKEN` | any secret word; you type it once when setting up the company |

Then go to **Deploys > Trigger deploy > Deploy site**. The build takes a minute or two.

### 5. Set up your company
1. Open your site address (shown at the top of the Netlify site page, e.g. `https://acme-workforce.netlify.app`).
2. Fill in **Set up your company**: your setup code, company name, office address, first project and shifts, meal vendors (no menu needed), and your administrator account. Do this **from the office**, so the office's internet address is filled in for you.
3. Invite your management team from **Admin > People > Invite management**. Project managers then invite their supervisors and teams from **Projects**. Everyone receives an email with an **Accept invitation** button, chooses a password, and is in.

### 6. Optional: your own address and the office-only rule
- **Custom domain**, e.g. `work.yourcompany.co.ke`: in Netlify, go to **Domain management > Add a domain** and follow the steps. HTTPS is automatic. Invitation links use the site's primary domain.
- **Office only**: under **Admin > Network zones**, check that your office's public internet address is listed (add each office). Then add `ENFORCE_NETWORK` = `true` in Netlify and redeploy. The app then works only from those offices, but invitation links still work from home.

---

## Automatic Labelbox counting

The `extension` folder is a Chrome and Microsoft Edge extension. Once a labeller has signed in to it:

1. When they click **Start labeling** (or **Start reviewing**) in Labelbox, their production shift starts in UnifiedWorkforce.
2. While the Labelbox tab is in front and they are using the keyboard or mouse, working time is counted. After 5 minutes with no activity, time stops counting until they continue.
3. Each **Submit** adds 1 to *labelled*; each **Approve** or **Reject** adds 1 to *reviewed*. A double-click counts once.
4. Every minute the extension reports to UnifiedWorkforce. The labeller's **My shift performance**, the supervisor's **Team attendance** and **Team performance**, and the **ranking** update on their own. When the shift ends, it closes with these figures, and a reason is asked for if it is below target.

Time and items only count inside the person's rostered shift. If the computer is offline, reports wait and are sent when it reconnects. The extension icon shows today's count.

**What it sees.** Only the *names* of the buttons people click on Labelbox pages, and whether the page is in use. It never reads labels, images or anything typed. Tell your team about it in a short monitoring notice (the design calls for this under Kenya's Data Protection Act 2019).

**Set the targets to match.** The extension counts *items* (one Submit = one data row), not individual boxes or polygons. Under **Admin > Targets**, set the labelling and review targets in items per productive hour. For example, if a row typically has 20 annotations and the goal is 900 annotations an hour, set 45. Counting individual annotations and Labelbox's own quality scores needs Labelbox's API (a company API key); that is the next step if you need it. Until then, supervisors can add quality by hand.

**If your Labelbox shows different button names**, an administrator can change them under **Admin > Labelbox detection**. Every extension picks up the change within 10 minutes. The same page lists every extension report from today and yesterday, which helps when checking a new setup.

### Try it on one computer
1. In Chrome, open `chrome://extensions` (in Edge, `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension` folder.
3. Click the UnifiedWorkforce icon in the toolbar (pin it from the puzzle-piece menu). Enter your site address (e.g. `https://acme-workforce.netlify.app`), your work email and password, and allow access when asked.
4. Open Labelbox and click **Start labeling**. The icon starts showing your count, and **My shift performance** in UnifiedWorkforce shows "Counting labels".

The person must be a member of a labelling team with a shift running. Sign in from the office if the office-only rule is on.

### Roll it out to the team
- **Google Workspace / Chrome Enterprise or Microsoft Intune / Group Policy:** publish the extension privately, either as an *unlisted* item in the Chrome Web Store or Microsoft Edge Add-ons, or hosted on your own server. Then force-install it on company computers with the `ExtensionInstallForcelist` policy, as the design recommends, so it can't be removed.
- **Prefill your address:** set the extension's managed setting `siteUrl` to your site address. The extension declares it in `managed_schema.json`, and you set it under "Configure extension" or through the `3rdparty` policy. Labellers then only enter their email and password.
- Each labeller signs in to the extension once. The sign-in lasts 30 days and stops working immediately if their account is deactivated.

---

## Meals

- **Booking:** staff book **a meal** for their next working day, or choose **no meal**. There is no dish choice; the weekly menu is agreed with the vendor outside the system. Bookings can be cancelled until the vendor's cut-off (by default 2 hours before the vendor's order deadline).
- **Reminder email:** a set number of minutes before each person's shift ends (30 by default), the system emails a "book your meal" reminder, with a **Book my meal** button, to everyone who is checked in for that shift and hasn't booked their next meal or chosen "no meal" while booking is still open. Each person gets one reminder per meal. Change the timing, or set it to 0 to switch reminders off, under **Admin > Rules**.
- **At each vendor's cut-off:** the day's bookings are locked and become one order showing the number of meals, the headcount per shift, the value, and the staff numbers (never names). The vendor sees it on the **Vendor portal**, and Logistics sees it on **Orders and headcount**, with a checklist for marking who collected.
- **On the 24th at 23:59:** the meal period (25th to 24th) locks. Vendor invoices, the Finance report and the payroll deduction file are produced from the same locked records that Logistics sees. Uncollected meals are still paid and deducted. Vendors enter their KRA eTIMS invoice number in the portal, and Finance sees any vendor without a matching one.

---

## Email

The system sends invitations, password resets, "accepted" notices and meal reminders through any SMTP account:

| Service | SMTP_HOST | SMTP_PORT | Notes |
| --- | --- | --- | --- |
| Brevo, Mailgun, SendGrid, Postmark | from their dashboard | 587 | Easiest for a website. Verify your company domain with them so mail isn't marked as spam. |
| Google Workspace | `smtp.gmail.com` | 587 | Use the sending mailbox and an **App password** (requires 2-step verification). |
| Microsoft 365 | `smtp.office365.com` | 587 | The mailbox must have **Authenticated SMTP** turned on (Microsoft 365 admin center). |

Leave `SMTP_SECURE` as `false` for port 587. If an email fails (wrong password, service down), it waits and is retried automatically. An administrator can resend any invitation from the person's **Invitation** button.

---

## Costs and limits

- **Neon**: the free plan easily holds a company of this size.
- **Netlify**: every page load, save and update check is one function call. Open screens check for changes every 15 seconds (`POLL_SECONDS`), which is about 1,900 calls per person for an 8-hour day with the app open. Background tabs check much less often. For example, 30 people with the app open all day is roughly 1.3 million calls a month. Check this against the function allowance on your Netlify plan. If it's too many, set `POLL_SECONDS` to 30 or 60: screens then refresh a little less often, and saving is unaffected.
- Netlify functions have a time limit per call. The system keeps each call short; invitation emails that don't fit in the call are sent by the scheduled job within a minute.

---

## How it works

| Part | What it does |
| --- | --- |
| **Records** | The company's records are stored as eight versioned groups in PostgreSQL. A save includes the versions the browser last saw. If anyone else saved first, the server answers *stale* and the browser re-applies the change to the latest copy, so nobody's change overwrites anyone else's. |
| **Rules on the server** | The server checks every save of people and settings. Only administrators can grant management roles or change projects, shifts, network zones or company settings. Project managers can only add and change team members and supervisors on their own projects. An invited person can only be activated by accepting their invitation, and at least one administrator always remains. |
| **Sign-in** | Email and password. Passwords are stored as bcrypt hashes, and sessions use a secure HttpOnly cookie. Deactivated people can't sign in. |
| **Invitations** | A personal link that works once and expires after 7 days. Only a SHA-256 hash of each link is stored, and resending replaces the link. |
| **Email** | Saved in the same transaction as the invitation, sent straight away if possible, and otherwise retried every minute. |
| **Office network** | The server checks the visitor's address as reported by Netlify, which can't be faked with a header. |
| **Time** | The browser uses the server's clock. |
| **Extension reports** | Stored apart from the app's records, so heartbeats never block anyone's save. The server credits at most the real time since the previous report (90 seconds at most) and at most 20 items per report, and only inside the person's shift. The extension's key can only report activity and read the person's own totals. |

### Files

```
netlify.toml              build settings, function settings, security headers
web/                      the web app (page, styles, and app code in web/src)
server/                   the API: records, sign-in, invitations, email, rules
functions-src/            the two Netlify functions (bundled into netlify/functions/ by the build)
extension/                the Chrome / Edge extension that counts Labelbox work
scripts/                  build steps and a local server that behaves like Netlify
test/                     39 tests: API and security (13), extension reporting (6), meal reminders (5),
                          the app in simulated browsers (8), and the extension on a mock Labelbox page (7)
```

### Run it on your own computer

Needs Node.js 20 and PostgreSQL.

```bash
npm install
export DATABASE_URL=postgresql://localhost/uws JWT_SECRET=$(openssl rand -base64 48)
npm run dev                # http://localhost:8888
npm test                   # needs a database named uws_test, or set TEST_DATABASE_URL
```

The Netlify CLI (`netlify dev`) also works.

---

## Known limits

- **Business rules run in the browser.** Day-to-day calculations (check-in rules, shift close, rates, meal pricing, period close) run in the browser and are saved to the server. The server enforces who may grant access and change settings, but doesn't re-check everyday records; a signed-in employee who deliberately edits their own records with browser tools wouldn't be stopped.
- **Some scheduled jobs need an open browser.** Marking absences, closing shifts, meal cut-offs and the 24th period close run while someone has the app open, and catch up when someone next opens it. Emails and meal reminders don't depend on this; they are sent by the scheduled function every minute.
- **Items, not annotations.** The extension counts items submitted and reviewed, and working time. Counting individual annotations and pulling Labelbox's quality scores needs the Labelbox API; quality is entered by hand until then.
- **Button names are an assumption.** The extension recognises Labelbox's buttons by their names, matched against "Start labeling", "Submit" and "Approve"/"Reject". I could not test it against the live Labelbox site. If Labelbox renames a button, counting stops for that button until an admin updates **Admin > Labelbox detection**. Check the reports on that page during the first day.
- **Order and month-end notices are in-app.** Vendors and Logistics see each order on their pages and in their Inbox, and Finance and Logistics are notified there when the period closes; these are not emailed yet.
- **History is trimmed.** Daily records older than about 50 days are summarised month by month.
