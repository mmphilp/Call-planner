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
* **Holidays** are covered like weekends and balanced separately. A holiday on a Friday stretches that weekend block to start at 7am Friday (Christmas Eve and Day: 7am Thursday); one on a Monday stretches it to 7am Tuesday. Thanksgiving always runs through the Friday after: Thursday 7am to Monday 7am. Any other weekday holiday gets its own holiday block, 7am to 7am the next day. The night before a holiday stays with the team. With a shared weekend service, only that service covers holidays; the specialty teams have no call on them.

## The workflow

1. **Set up** (admin): create the half-year, add holidays, check services and surgeons.
2. **Take requests**: open the period. Surgeons use the app to send *Unavailable*, *Prefer off* or *Would like call* requests for date ranges, optionally limited to days, nights or weekends. There's an optional deadline.
3. **Build schedule** (admin): close requests, approve/deny them, click **Generate optimized schedule**, then adjust by hand. Any hand-picked assignment is locked, so re-optimizing works around it.
4. **Publish**: surgeons see their call in the app and can subscribe to it in their phone's calendar.

### Multi-specialty groups: team admins and routine days

* **Shared weekends, team weekdays.** Make one service cover weekend blocks only (e.g. *Specialty Coverage*, with everyone on it), and give each specialty its own service for weekday days and nights. Weekend blocks apply to the whole group, so no specialty gets a Friday-night shift or a weekday shift on a holiday folded into a long weekend.
* **Team admins.** On a surgeon's profile, tick *Team admin for weekday call* for their specialty. They can sign in to the admin console and:
  * set routine days;
  * edit their team's weekday shifts;
  * optimize just their team's weekdays (nothing else is changed);
  * see requests and fairness, read-only.

  Weekends, surgeons, services, rules, request approvals and publishing stay with the overall admin.
* **Week-long teams** (*Weekday call* page). A team can cover weekdays **one surgeon per week**: Monday through Friday days and Monday–Thursday nights.
  * Whole weeks go to whoever is free all week, alternating and shared fairly by FTE.
  * A one-person team gets every week its surgeon is available.
  * Weeks nobody can take whole are filled day by day.
  * Rest and nights-per-week limits don't apply to week-long call. Day-by-day teams can switch them off too, e.g. small teams on home call.
  * Fair share is worked out within each team, and weekends across everyone.
* **Cross-cover.** A team can name a covering service. When nobody on the team is available for a weekday shift, whoever is on call for that service at the same time covers it too. Cross-cover is shown in italics and recalculated whenever the covering team's schedule changes. Manual picks and locums take priority.
* **Routine days** (*Weekday call* page). Pick who always takes a given weekday's day or night shift, e.g. Mon/Wed days. When the schedule is optimized, routine days are filled first, except on holidays or when that surgeon has time off. They count toward fair share, and everything left on *Rotate* is shared out.
* **Locums.** In any shift's dropdown, choose *Locum / outside cover…*. That shift is then left out of the optimizer and the fair-share math.
* **Holidays.** The group's holidays are New Year's Day, Memorial Day, Juneteenth, Fourth of July, Labor Day, Thanksgiving, Christmas Eve and Christmas.
  * They're marked by name on every calendar.
  * Each schedule's Overview tab sets the day the hospital *observes* each one. New schedules start on the usual rule: Saturday → Friday, Sunday → Monday.
  * Observed days are covered by the weekend service only: they stretch long weekends, or get a holiday block of their own. To add another day the hospital observes, add it to the schedule's list. Christmas Eve and Christmas count as one holiday on the *Holidays* page and in the rotation.
  * The *Holidays* page shows who covered which holiday each year. The optimizer rotates a holiday away from whoever had it last time.
* **Swaps and giveaways.** On a published schedule, a surgeon taps a shift in *My Call* to offer it to anyone who covers that service, or to propose a swap for a colleague's shift of the same kind.
  * Once it's taken or accepted, it appears on the schedule's *Swaps* tab. The admin sees any rule problems it would cause before approving.
  * Approving updates the schedule and calendars.
  * The overall admin approves weekends; team admins approve their team's weekday trades.
* **Viewer role.** For an assistant: in the app they get *Schedule* and *Profile* (no *My Call* or *Requests*), plus read-only access to the admin console (schedules, requests, swaps, fairness, holidays, CSV export, printing). They can't change anything or send requests.
* **Calendar.** Once a schedule has assignments, the Schedule tab opens on a month calendar of who covers each service each day. It's printable, and the *Highlight* box picks out one surgeon. In the app, the Schedule screen has a *Month* view: dots mark your call days, and tapping a day lists who's on.
* **Calendar labels.** On the *Services* page, each service can have a short calendar label (e.g. *CRS* for Colorectal, *Surg Onc* for Surgical Oncology). Left blank, it's worked out from the name.
* **Service coverage.** Tick only the call each service covers; a shared weekend service should only have *Weekend block*. Changing coverage updates unpublished schedules automatically. A published schedule shows a warning with an *Unpublish and rebuild shifts* button.
* **Scope.** The overall admin can optimize *Everything*, *Weekends only*, or one team's weekdays.

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
npm run dev:admin           # admin console on http://localhost:5173/admin/
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

## Self-hosting (Docker)

One container runs everything on one port, with **one address for everyone**: `http://<server>:4000/`.

* Everyone signs in there and gets the app (on a phone or iPad, use **Share → Add to Home Screen**).
* The overall admin, team admins and view-only accounts also see an **Admin console** card on *Profile*. It opens the console already signed in, and the console's *My schedule* link goes back.
* On a computer you can bookmark `http://<server>:4000/admin` to go straight to the console.
* Old `/app` links and home-screen icons redirect to the new address.
* `http://<server>:4000/cal/…` is each surgeon's calendar feed.

### 1. Start it

On any Linux box with Docker and Docker Compose (a homelab server, NAS or VM):

```bash
git clone https://github.com/mmphilp/Call-planner.git
cd Call-planner
cp .env.example .env
nano .env            # set JWT_SECRET (openssl rand -base64 48), ADMIN_EMAIL, ADMIN_PASSWORD, SUPPORT_EMAIL
docker compose up -d --build
```

Open `http://<server-ip>:4000/admin` and sign in with the admin email and password from `.env`. The account is created on the first start with an empty database. Then add services and surgeons, and create your first half-year.

**Optional: demo data instead.** To try it out with the 12 demo surgeons and a sample schedule, run this once *before* the first `up`:

```bash
docker compose run --rm call-planner node --import tsx apps/api/src/seed.ts
docker compose up -d
```

This signs in as `admin@example.com` / `password123`. Remove the demo data before real use with `docker compose down -v`, which **deletes the database**.

### 2. Reach it from outside your home

Surgeons need to reach the server from their phones anywhere, and logins should go over HTTPS. Pick one:

* **Cloudflare Tunnel (recommended).** Free, no port forwarding, and HTTPS is automatic. It needs a domain on Cloudflare. In the Cloudflare dashboard go to Zero Trust → Networks → Tunnels, create a tunnel, point a hostname such as `call.yourdomain.com` at `http://call-planner:4000`, and add the connector to `docker-compose.yml`:
  ```yaml
    cloudflared:
      image: cloudflare/cloudflared:latest
      restart: unless-stopped
      command: tunnel run
      environment:
        - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
  ```
  Put `CLOUDFLARE_TUNNEL_TOKEN=…` in `.env` and set `TRUST_PROXY=true`.
* **A reverse proxy you already run** (Caddy, Traefik, Nginx Proxy Manager). Proxy your domain to port 4000, forward 443 on your router, and set `TRUST_PROXY=true`.
* **Tailscale.** Good for a private demo (your own devices only). Every surgeon would need Tailscale installed, so it's not a fit for the whole group.

Wrong passwords are limited to 10 per account per 15 minutes, and 50 per network address. Successful sign-ins are never limited, so a whole hospital on one shared network is fine.

### 3. Update, back up, view logs

```bash
git pull && docker compose up -d --build        # update to the latest version

docker compose stop                             # back up (takes a few seconds)
docker compose cp call-planner:/data/call-planner.db ./backups/call-planner-$(date +%F).db
docker compose start

docker compose logs -f                          # logs
```

The database lives in the `call-planner-data` Docker volume, so it survives updates and restarts. Back it up regularly, and keep a copy off the server.

### Native iPhone/Android apps (optional)

The web version at `/` covers what surgeons need. For App Store / Play Store apps: set `EXPO_PUBLIC_API_URL` to your public URL, change the `com.example.callplanner` bundle IDs in `apps/mobile/app.json`, then build and submit with EAS (`npx eas-cli build`, `npx eas-cli submit`). This needs an Apple Developer account and a Google Play Console account. Any build has to reach the server over HTTPS.

Schedules contain staff names and phone numbers but no patient data. Still, check your hospital's IT/security requirements before hosting.

## Not built yet

Ideas for next steps: push/email notifications (new schedule published, request decided), a password-reset email flow, and an audit log of schedule changes.
