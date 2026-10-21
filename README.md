# Pocketwise

Pocketwise is a portable English budget dashboard. A single HTML file runs locally on a laptop. The web version can be installed on an iPhone from Safari and keeps working offline after the first visit. Optional Supabase Auth and Postgres sync each person's records between devices when a connection returns.

The public site contains only application code and a Supabase **publishable** key. Financial entries stay in the browser's IndexedDB and each signed-in user's RLS-protected Supabase row. The app does not connect to CIB, InstaPay, or bank accounts. It does not automatically import transactions.

## Set up Supabase

1. Create a Supabase project. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql).
2. Keep email sign-in enabled in **Authentication → Providers**. Configure email confirmation and recovery to suit your project.
3. Set **Authentication → URL Configuration → Site URL** to your GitHub Pages address, `https://OWNER.github.io/REPOSITORY/`. Add the same address to redirect URLs.
4. Copy the **Project URL** and **publishable key** from **Project Settings → API Keys**. A legacy `anon` key also works. Never use a `secret` or `service_role` key in this app.

## Publish on GitHub Pages

1. Push this source to a dedicated public GitHub repository. There is no personal budget data in this source tree.
2. In repository **Settings → Secrets and variables → Actions → Variables**, add `POCKETWISE_SUPABASE_URL` and `POCKETWISE_SUPABASE_PUBLISHABLE_KEY` with the values above.
3. In repository **Settings → Pages**, choose **GitHub Actions** as the build and deployment source.
4. Run **Actions → Publish Pocketwise** or push to `main`. The workflow checks the app, builds it, and publishes its static files.

Everyone can open the public website. To sync their data, visitors create individual accounts. RLS allows them to read and update only their own budgets. Local data stays available offline; it syncs when the network returns. If two devices edit independently, Pocketwise asks which copy to keep and downloads a backup of the other copy before replacement.

## Make a laptop copy

With Node.js 22+ installed, run `npm ci` and `npm run check`, then build:

```sh
POCKETWISE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
POCKETWISE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY npm run build
```

The build writes `Pocketwise-Desktop.html` beside the output folder. Copy this one HTML file to a laptop and open it in a normal browser window. Copying the file does not copy saved transactions: use **Settings → Export backup** and **Restore backup**, or sign into the same account and sync. The hosted website provides the most consistent install and offline behavior across laptop and iPhone browsers.

The publishable key is designed for browser use. All actual authorization depends on Supabase Auth and the RLS policies in `schema.sql`. Keep financial backups private because JSON exports are plain text.
