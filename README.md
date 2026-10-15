# Tansi Honda – Sales Manager Checklist (Android app)

Native Android shell for the Google Apps Script checklist web app.

- Full screen, no browser bars, Android back button, offline screen
- "Take photo" opens the phone camera directly (live photo only); gallery only where the item allows screenshots
- GPS location is passed to the web app for the photo stamp (works inside Google Sites too)
- WhatsApp / Call buttons open the real WhatsApp / dialer

## Build
Every push to `main` builds a signed APK (Actions tab → latest run → artifact, and a GitHub Release).
To bake in the app link: Actions → Build APK → Run workflow → paste the link,
or set the repository variable `START_URL`. Without a link the app asks for it once on first launch.

Signing key: `keystore/release.jks` + `keystore/password.txt` (this repo is private – keep it private).
Optional hardening: move them to repository secrets `KS_B64` (base64 of the .jks) and `KS_PASS`, then delete the files.
Keep a copy of the key safe – every future update must be signed with the same key or phones will refuse to update.

`webapp/` holds the Google Apps Script code (Code.gs, Index.html, appsscript.json) for version history.
