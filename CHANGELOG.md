# Changelog

## Unreleased

- **Multiple hospitals.** Add hospitals on the Services page and tick which ones each service covers (none = all). Different surgeons at each hospital: a service per hospital; one surgeon covering several: one service ticked for all of them. Surgeons who rotate tick each under *Can cover*; fair share stays combined.
- **Weekends per hospital.** A weekend service takes over Friday nights and observed holidays only at the hospitals it covers; a hospital with no weekend service keeps its weekday teams' Friday night and holiday call. Several weekend services can split the hospitals between them.
- **Hospital filter** on the console's calendar and grids, and in the app's Schedule tab.
- **Test copy support**: run a second copy on the same server (`INSTANCE`, `HOST_PORT` in `.env`), with a banner on every page (`INSTANCE_LABEL`, e.g. "Test copy") so it can't be mistaken for the real site. See README → A test copy.
- **Copy live data** (test copy only, with `LIVE_URL` set): the admin console's sidebar gets a page that replaces the test copy's data with a fresh copy of the live site's, using the live admin's email and password once. Nothing on the live site changes.

## 1.0.3

- **View-only accounts use the app only**: no admin console, and no access to drafts, requests, reports or the roster. They see published (and in-review) schedules in the app.
- **Delete people** from the Surgeons page (Edit → Delete). If they're still on shifts it says how many and asks again; those shifts are left unfilled, and changes to published schedules are logged.
- **Call share** is a number box (any %), not a fixed list.
- **Weekday call page**: no Friday-night routine box when a service covers weekends (Friday night is part of the weekend block).

## 1.0.2

- **Automatic daily backups** of the database, made while the app runs, in `/data/backups` (next to the database), keeping the newest 14 (`BACKUP_KEEP`; `0` turns them off; `BACKUP_DIR` to put them elsewhere).
- **Download backup** in the admin console sidebar (overall admin): a full copy of the database to keep somewhere safe.
- README: backing up off the server, and restoring.

## 1.0.1

- **Password changes at first sign-in.** Accounts created in the console start with a temporary password: the person must choose their own the first time they sign in (app or console). The same applies when the admin resets someone's password.
- **Require a password change** for one person (checkbox when editing them on the Surgeons page) or for everyone except yourself (**Require everyone to change password**). Enforced by the server: until it's changed, nothing else works.
- **Change password** for everyone: Profile in the app, and the sidebar in the console.

## 1.0.0 — first production release

Call scheduling for a multi-specialty surgical group: a web/phone app for surgeons and an admin console, served from one address.

- **Schedules** by half-year (January–June, July–December): weekday day (7am–5pm) and night (5pm–7am) call per service, and weekend blocks (Friday 5pm – Monday 7am).
- **Requests**: time off, preferences and call wanted, for date ranges or separate days; approved in the console.
- **Optimizer**: fair share per FTE within each team (weekends across the group), honours requests, rest and spacing rules, routine days, week-long teams, cross-cover from a backup service, locums, and holiday rotation.
- **Holidays**: New Year's Day, Memorial Day, Juneteenth, Fourth of July, Labor Day, Thanksgiving, Christmas Eve and Christmas, with the hospital's observed day per schedule. Observed weekday holidays go to the weekend service only; Thanksgiving runs through the Friday after; Christmas Eve and Christmas count as one holiday.
- **Review and sign-off**: send a proposed schedule for review; surgeons flag problems and approve their own call; service schedulers sign off and can publish their service on its own; publish all when ready.
- **After publishing**: swaps and giveaways between surgeons, single-shift edits marked as changed, and an admin-only change log.
- **Roles**: overall admin, team admins (weekday call for their services), surgeons, and view-only.
- **App**: My Call (upcoming, past, calendar), group schedule filtered to your services, requests, swaps, flags, and calendar subscription.
