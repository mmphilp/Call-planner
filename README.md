# Call Planner

Call scheduling for a surgical group: surgeons send requests from an iPhone/Android app, and the scheduler builds, adjusts and publishes a half-year schedule from a web admin console with an optimizer that suggests the schedule.

## How call is structured

| Shift | Hours | Days |
|---|---|---|
| Weekday day | 7am – 5pm | Mon – Fri |
| Weekday night | 5pm – 7am next day | Mon – Thu |
| Weekend block | Fri 5pm – Mon 7am | every weekend |

* Each **service** (e.g. General Surgery, Trauma) chooses which of these it needs covered, and each surgeon is set up for the services they can cover.
* Schedules are built per **half-year**: January–June and July–December.
* **Holidays** are balanced separately. A holiday on a Friday or Monday stretches that weekend block (Thu 5pm start or Tue 7am end).

## The workflow

1. **Set up** (admin): create the half-year, add holidays, check services and surgeons.
2. **Take requests**: open the period. Surgeons use the app to send *Unavailable*, *Prefer off* or *Would like call* requests for date ranges, optionally limited to days, nights or weekends. There's an optional deadline.
3. **Build schedule** (admin): close requests, approve/deny them, click **Generate optimized schedule**, then adjust by hand. Any hand-picked assignment is locked, so re-optimizing works around it.
4. **Publish**: surgeons see their call in the app and can subscribe to it in their phone's calendar.

### What the optimizer does

* **Never** (hard rules): schedules approved time off; schedules someone for a service they don't cover; double-books; gives less than *12h* rest between shifts (so no day after a night); gives more than *2* weekday nights a week; or back-to-back weekends. If a shift can't be filled without breaking a rule it's left open and flagged.
* **Tries to** (priorities, adjustable on the *Rules* tab): give everyone equal call per FTE (separately for days, nights, weekends and holidays), honor preference requests and pending time off, and spread shifts out.

The numbers in italics are defaults you can change per half-year. The *Fairness* tab shows each surgeon's count against their fair share, and lists any requests that couldn't be met.

## Project layout

```
packages/core   Scheduling logic: shift generation, rules, optimizer (TypeScript, no dependencies)
apps/api        REST API (Fastify + SQLite)
apps/admin      Web admin console (React + Vite)
apps/mobile     iPhone & Android app (Expo / React Native)
```

## Running it locally

Requires Node 22+.

```bash
npm install                 # core, api, admin
npm run seed                # demo data → apps/api/call-planner.db
npm run dev:api             # API on http://localhost:4000
npm run dev:admin           # admin console on http://localhost:5173
```

Demo logins (password `password123`): `admin@example.com` (admin), `surgeon1@example.com` … `surgeon12@example.com`.

Mobile app (separate install, since Expo manages its own dependency versions):

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:4000 npx expo start
```

Scan the QR code with the camera (iPhone) or the Expo Go app (Android). Use your computer's LAN IP, not `localhost`, so the phone can reach the API.

## Tests

```bash
npm test          # core optimizer + API workflow tests
npm run typecheck
cd apps/mobile && npx tsc --noEmit
```

## Going to production

* **API**: set `JWT_SECRET` (required) and `DATABASE_PATH`, put it behind HTTPS, and back up the SQLite file. Move to Postgres if you need multiple servers.
* **Admin console**: `npm run build -w @call-planner/admin` and serve `apps/admin/dist`, routing `/api` and `/cal` to the API.
* **Mobile**: set `EXPO_PUBLIC_API_URL` to the production API. Change the `com.example.callplanner` bundle IDs in `apps/mobile/app.json`, then build and submit with EAS (`npx eas-cli build`, `npx eas-cli submit`). This needs an Apple Developer account and a Google Play Console account.
* Schedules contain staff names and phone numbers but no patient data. Still, check your hospital's IT/security requirements before hosting.

## Not built yet

Ideas for next steps: push/email notifications (new schedule published, request decided), shift swaps between surgeons, a password-reset email flow, and an audit log of schedule changes.
