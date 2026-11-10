# Paseo plugin registry submission

Submit with the [official form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml).
The form supplies the label that starts review. The listing is approved as `js2me/browser`:
[submission #2184](https://github.com/getpaseo/plugins/issues/2184),
[merged review #2185](https://github.com/getpaseo/plugins/pull/2185).
Submit new Git revisions separately so the catalog's reviewed pin can be updated.

- **Title:** Paseo Browser
- **Source:** https://github.com/js2me/paseo-browser
- **Revision:** select the exact commit to review.
- **Categories:** Workspaces, Utils.

Suggested description:

> Paseo Browser gives agents and people a shared Chromium workspace. It renders natively on desktop, opens DevTools for the selected tab, and broadcasts that same session to mobile/web clients. Standard Paseo supports mobile viewing through native-tab screenshots. The optional desktop bridge adds faster capture, full CDP and HttpOnly cookie management. Legacy daemon-hosted Chrome is also available. Preparation uses a locked dependency tree and does not automatically download a browser.

Listing screenshots:

- https://raw.githubusercontent.com/js2me/paseo-browser/main/assets/native-desktop.png
- https://raw.githubusercontent.com/js2me/paseo-browser/main/assets/native-mobile.png

`OVERVIEW.md` owns the listing copy. `integrations/paseo/README.md` documents the bridge baseline.
The screenshots use sample data in an isolated Electron integration host and a phone-sized web client.
They do not represent physical iOS or Android testing.

The approved catalog ID is `js2me/browser`. Direct Git installation is also available:

```sh
paseo plugin add git:js2me/paseo-browser
```

Git-based listing updates require a new submission with the desired revision. Pushing to this
repository alone does not update the registry's reviewed pin.
