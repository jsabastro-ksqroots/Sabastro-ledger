# HOW_TO_RUN.md — running Sabastro Ledger on your Mac

Written for someone who has never used the Terminal. Every command below is typed into the Terminal
app (Applications → Utilities → Terminal, or press ⌘-Space and type "Terminal"). Copy a command, paste
it, press Return, wait for it to finish.

## 1. One-time installs (about 15 minutes)

1. **Docker Desktop** (runs the database). Go to <https://www.docker.com/products/docker-desktop/>,
   download "Docker Desktop for Mac (Apple silicon)", open the downloaded file, drag Docker into
   Applications, open Docker from Applications, accept the license, and wait until the whale icon in the
   menu bar stops animating. Leave Docker running whenever you use the app.
2. **Node.js 22 (LTS)** (runs the app). Go to <https://nodejs.org/>, download the **22 LTS** installer
   (the .pkg file), open it and click through. Then in Terminal run:

   ```bash
   corepack enable
   ```

   If that says "permission denied", run `sudo corepack enable` and type your Mac password (it will not
   show as you type). This turns on `pnpm`, the tool that runs everything else.

3. **Check** both worked:

   ```bash
   node --version && pnpm --version && docker --version
   ```

   You should see three version numbers (Node starting with v22).

> On the Mac used for Phase 0, Docker and Homebrew were not installed and could not be installed without
> an admin password, so Claude Code installed Node into `~/.local/node` and used a Postgres that runs
> without Docker (see section 6). Once you install Docker Desktop, the normal path below works.

## 2. Get into the project folder

The project lives in the folder that contains this file. In Terminal type `cd ` (with a space), then drag
the project folder from Finder onto the Terminal window, and press Return. Everything else assumes you
are in that folder.

> The folder is currently inside Google Drive ("My Drive"). That works, but Drive will try to sync the
> huge `node_modules` folder and can slow things down. Moving the folder to `~/Projects/sabastro-ledger`
> (outside Drive) is recommended; nothing in the app depends on the location.

## 3. Create your settings file (`.env`)

```bash
cp .env.example .env
```

Open `.env` in TextEdit (`open -e .env`) and fill in:

- `TOTP_ENCRYPTION_KEY` — paste the output of:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` — Jose's login (12+ characters, upper and lower case, a number).
- `SEED_FULL_EMAIL` / `SEED_FULL_PASSWORD` — Jamin's login.
- `APP_DB_PASSWORD` — any long random string; also put it into `APP_DATABASE_URL` after `ledger_app:`.

Save and close. **Never share or commit `.env`** — it is ignored by git on purpose.

## 4. Start everything

First time (installs, starts the database in Docker, creates the tables and the two users):

```bash
pnpm run setup
```

Then, every time you want to use the app:

```bash
pnpm dev
```

Open <http://localhost:3000> in your browser. To stop, go back to Terminal and press Ctrl-C.
The database keeps running in Docker; `pnpm db:down` stops it (your data stays).

## 5. First sign-in

1. Enter your email and password.
2. The app shows a QR code. Open an authenticator app on your phone (Google Authenticator, Microsoft
   Authenticator, 1Password, Authy…), tap "+" / "Add", scan the code, and type the 6-digit number it
   shows. (No phone camera? Type the key printed under the QR code instead.)
3. Ten **recovery codes** appear once. Print them or save them in a password manager. Each one lets you
   in once if you lose your phone.
4. From then on: email + password + the current 6-digit code.

Forgot your password or lost your phone _and_ the codes? The Owner (or any Full-access user for a
Limited user) can set a temporary password or reset MFA from Settings → Users.

## 6. Without Docker (what Claude Code used in Phase 0)

If Docker is not installed, the app can run a private Postgres 16 from inside the project instead:

```bash
pnpm setup:nodocker
```

and then, each time:

```bash
pnpm dev:nodocker
```

The data lives in the `.pg` folder inside the project (ignored by git). Everything else is identical.

## 7. Running the tests

```bash
pnpm test
```

runs every unit test (sign-in, MFA, lockout, permissions, audit-log immutability, seeding). It starts its
own throw-away database, so it needs no setup. `pnpm test:core` runs only the accounting-core tests (the
"invariant suite" that must stay green). For the browser smoke test (sign in → enrol → dashboard):

```bash
pnpm e2e:install
```

once, then

```bash
pnpm test:e2e
```

(it starts the app on port 3100 and uses the database in `.env`).

## 8. Useful commands

| Command                        | What it does                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `make`                         | lists these shortcuts                                                                        |
| `pnpm db:seed`                 | re-runs the seed; safe to repeat, never overwrites edits                                     |
| `pnpm db:studio`               | opens Prisma Studio, a table viewer for the database                                         |
| `pnpm db:recreate`             | **wipes the local database** and rebuilds it (development only; refuses non-local databases) |
| `pnpm lint` / `pnpm typecheck` | code checks Claude Code runs before every commit                                             |

## 9. If something goes wrong

- **"command not found: pnpm"** — run `corepack enable` (section 1) and open a new Terminal window.
- **"Timed out waiting for the database"** — Docker Desktop is not running; open it and retry.
- **Port 3000 already in use** — another copy is running; press Ctrl-C in that window, or run `pnpm exec next dev -p 3001` and use <http://localhost:3001>.
- **Locked out after wrong passwords/codes** — wait 15 minutes, or ask the Owner to unlock you in Settings → Users.
- **Anything else** — copy the red text from Terminal and paste it into a Claude Code session.
