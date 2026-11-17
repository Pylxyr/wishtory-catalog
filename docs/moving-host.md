# Moving to another host later

What the build makes (`dist/site/` after `node scripts/build.mjs`) is a plain folder of static files. Any host
that serves files over HTTPS can serve it. The signed data refers to pictures by paths relative to `v1/`, so the
folder works unchanged under any address.

1. Pick the new address, for example `https://data.example.org/wishtory/v1/`. A custom domain on GitHub Pages
   (Settings → Pages → Custom domain) is the easiest, because you can move the domain again later without an app
   update.
2. Change the publish step of `.github/workflows/publish.yml` to upload `dist/site/` to the new host (the build
   step stays as it is). Also change the address in the "Read the published version" step so new versions keep
   going up.
3. In the Wishtory repository change the one address in `crates/wishtory-core/src/catalog/own.rs` (`OWN_BASE_URL` and
   `OWN_HOST`), add the new host everywhere the app lists the hosts it talks to (the links allowed in
   `about.rs`, the redirect allow-list in `catalog.rs` and their tests, `PRIVACY.md` sections 2 and the data
   table, `docs/credits.md`), and release the app.
4. Keep the old site up for as long as people use older app versions. They keep reading it, and when it is
   unreachable they fall back to the app's other sources.
5. Publish once on the new host before releasing the app, so the first check finds data.
