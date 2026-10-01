# Railway: private hosted development

The existing Dockerfile starts the local Vite development launcher. Railway does
not guarantee the Docker marker file that launcher checks, so its wildcard-host
guard can reject startup. Do not disable that guard or set the web host to
loopback to work around the crash: external routing and access protection still
need a hosted entry point.

The root `railway.json` selects the existing Dockerfile for builds and overrides
its local-development command with `node scripts/hosted.mjs`. The gateway serves
`apps/web/dist`, forwards API requests to an embedded loopback Nest listener,
and requires HTTP Basic authentication for the frontend and API. The backend
keeps its local Host/Origin and mutation checks. This is a single-user hosted
development instance, not a multi-tenant hosted product.

## Service settings

1. Deploy the whole repository. Root Directory must be the repository root,
   not `examples/standalone`. The service display name `@pathsmith/standalone`
   is harmless, but deploying only that workspace will not launch the app.
2. Use the root `railway.json`. Remove an old Start Command override such as
   `pnpm dev` or `node scripts/dev.mjs`; the intended command is
   `node scripts/hosted.mjs`. Use the Dockerfile, not an auto-selected
   standalone workspace build. The Dockerfile already installs the pinned
   dependencies and builds all packages.
3. Keep one replica. Attach a persistent Railway volume at `/app/.pathsmith`.
   Set `PATHSMITH_DATA_DIR=/app/.pathsmith`. Migrations run as the API opens
   storage. Do not run a second process against that SQLite directory.
4. Generate a Railway HTTPS domain, then set:
   - `PATHSMITH_PUBLIC_URL`: the exact HTTPS origin, for example
     `https://your-service.up.railway.app` (no path).
   - `PATHSMITH_AUTH_USER`: your chosen login name.
   - `PATHSMITH_AUTH_PASSWORD`: a unique password of at least 16 characters.
     Enter this securely in Railway Variables, never in Git or chat.
   - `NODE_ENV=production`.
     Railway supplies `PORT`; the gateway listens on `0.0.0.0` at that port.
     `PATHSMITH_WEB_HOST` is unused by the hosted launcher.
5. Healthcheck Path is `/healthz`. It returns only readiness, without
   authentication; all application data and frontend assets require login.
6. Deploy the commit containing these files. Confirm the logs show hosted
   startup, health checks pass, and opening the HTTPS domain prompts for login.
   Check a mock run and reload its saved history. Back up the volume before
   destructive changes or migrations.

## Access and limitations

Use Railway's HTTPS domain on desktop or Android. HTTP Basic authentication
uses the browser's native login dialog; changing the password or closing the
browser's authenticated session is the available logout mechanism. Do not use
this gateway on an unencrypted public HTTP connection.

After 30 failed logins within a one-minute window, the shared gateway rejects
all further login attempts until the window resets, including correct passwords.
This limit applies to the single shared instance.

Requests must use the configured public host; browser Origin must match that
HTTPS origin. Mutations still require `X-Pathsmith-Client: local`, sent by the
existing frontend. Changing the public domain requires updating
`PATHSMITH_PUBLIC_URL` and restarting.

Mock and replay need no provider credentials. Live Jev remains separately
opt-in, with the existing backend flag, credential, per-run consent, and attempt
limits; startup never initiates a live request.

Keep one replica and one shared login. This does not add user accounts,
workspace authorization, multi-tenancy, quotas, or a durable distributed queue.
Use persistent-volume backups and treat scenario messages and exported reports
as sensitive. A built frontend hosted this way does not support Vite hot reload;
deploy new commits to update the code.

The code and controls can be validated locally. Railway publication, domain
routing, volume attachment, and platform configuration must be verified in
your Railway project; local checks do not establish a successful deployment.
