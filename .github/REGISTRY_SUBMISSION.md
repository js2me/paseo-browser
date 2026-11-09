# Paseo plugin registry submission

Submit with the [official form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml).
The form supplies the label that starts review. This repository is not yet an approved listing.

- **Title:** Paseo Browser
- **Source:** https://github.com/js2me/paseo-browser
- **Revision:** select the commit containing this publication preparation, or let the reviewer resolve `main`.
- **Categories:** choose the browser, developer tools or productivity options offered by the form.

Suggested description:

> Paseo Browser gives agents and people a shared Chromium workspace. It renders natively on desktop, opens DevTools for the selected tab, and broadcasts that same session to mobile/web clients. It supports accessibility automation, JavaScript, cookies, network/console inspection and guest-scoped CDP. Native mobile capture and full CDP require the included desktop bridge; this is documented separately from standard Paseo installation. Legacy daemon-hosted Chrome is also available. Preparation uses a locked dependency tree and does not automatically download a browser.

Listing screenshots:

- https://raw.githubusercontent.com/js2me/paseo-browser/main/assets/native-desktop.png
- https://raw.githubusercontent.com/js2me/paseo-browser/main/assets/native-mobile.png

`OVERVIEW.md` owns the listing copy. `integrations/paseo/README.md` documents the bridge baseline.
The screenshots use sample data in an isolated Electron integration host and a phone-sized web client.
They do not represent physical iOS or Android testing.

After publication, use the exact owner/slug assigned by the registry. Until then, direct installation is:

```sh
paseo plugin add git:js2me/paseo-browser
```

Git-based listing updates require a new submission with the desired revision. Pushing to this
repository alone does not update the registry's reviewed pin.
