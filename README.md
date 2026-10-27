# installable-web-app

[![Deploy on Back4app](https://img.shields.io/badge/Deploy%20on-Back4app-1568B8?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJMMiA3djEwbDEwIDUgMTAtNVY3eiIvPjwvc3ZnPg==)](https://www.back4app.com/signup?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app)

**A web app that installs to the home screen, opens without browser chrome, and still works with the server switched off — in three files, with a script that proves all of it.**  No build step, no framework, no app store.

Measured on 27 October 2026 against Chrome 155: all fourteen checks pass, Chrome's own installability verdict is **no errors**, the first load is **4,430 bytes** over the wire, and the offline reload is **0 bytes** — with the origin returning `ECONNREFUSED`, so the server is genuinely gone rather than quietly still answering.

> **Read the article:** [How to Publish Your App Without the App Stores, Using Back4app](https://www.back4app.com/blog/publish-your-app-without-the-app-stores?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app)

## What it does

Three files turn a web page into something a phone treats as an app:

| File | What it is for |
| --- | --- |
| `manifest.webmanifest` | the name, the icons and `display: standalone` — what makes the browser offer to install it |
| `sw.js` | a service worker that caches the shell on install and serves it from cache first |
| `index.html` | the app itself, with its own styles and script inline |

`verify.mjs` drives a real Chrome over the DevTools protocol and checks both claims: that the browser would install it, and that it survives the network being cut **and** the server being stopped.

## What we measured

```
installable web app — verification (Chrome/155.0.8059.85)

  ✓ manifest parses with no errors             []
  ✓ name and short_name present                Shift Notes / Shift Notes
  ✓ display is standalone or fullscreen        standalone
  ✓ start_url present                          ./index.html
  ✓ icons include 192px and 512px              192x192 512x512 512x512
  ✓ a maskable icon is offered                 purpose=maskable
  ✓ Chrome reports no installability errors    none
  ✓ a service worker is active                 state=activated
  ✓ the page is controlled by it               controller=true
  ✓ the shell is in the cache                  5 entries
  ✓ the origin is genuinely gone               ECONNREFUSED
  ✓ it still renders with the server stopped   h1="Shift Notes"
  ✓ it is still interactive offline            form and list present
  ✓ the browser agrees it is offline           navigator.onLine=false

  first load            4430 bytes over the wire, 18 ms to load event
  served from disk      21405 bytes
  offline reload        0 bytes over the wire
```

Stable across three consecutive runs.

**The finding worth the repo on its own:** remove the service worker registration and Chrome *still* reports no installability errors — it will happily install the app. But the offline reload then lands on Chrome's own error page, which the script catches as `h1="Press space to play"` and **184,663 bytes** pulled over a connection that is supposed to be dead. Installable and works-offline are two different properties, and only one of them is what a user means by "it's an app".

Chrome's bar is also lower than the checklist everyone repeats. Measured, one change at a time:

| Manifest | Chrome's verdict |
| --- | --- |
| icons `192` and `512` | installable |
| only `192` | installable |
| only `512` | installable |
| no icons at all | `manifest-missing-suitable-icon, no-acceptable-icon` |
| `display: browser` | `manifest-display-not-supported` |
| no `short_name` | installable |

With three faults present at once, Chrome named **one**. It reports the blocker it hit, not a list of everything wrong.

## Files

- `index.html` — the app. Inline styles and script, no dependencies.
- `manifest.webmanifest` — name, icons, `display: standalone`.
- `sw.js` — precache the shell on install, cache-first on fetch.
- `icons/` — 192, 512 and a maskable 512.
- `verify.mjs` — the fourteen checks above. Node 22+, no dependencies.

## Run it

```bash
node verify.mjs
```

Node 22 or newer (it uses the built-in `WebSocket` to speak the DevTools protocol) and a Chrome or Chromium on the machine. Point it at a specific binary with `CHROME=/path/to/chrome node verify.mjs`.

To try the app by hand, serve the folder over `http://localhost` — a service worker needs a secure origin, and `localhost` counts as one — then open it, use the browser's install option, and turn the network off.

## Deploy your own

1. **Create a free account.** Sign up at [https://www.back4app.com/signup?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app](https://www.back4app.com/signup?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app).
2. **Put the folder online** over HTTPS. A service worker will not register over plain HTTP anywhere but `localhost`, so the certificate is not optional.
3. **Give it a backend** when the notes need to outlive the device. The app keeps them in `localStorage`, which is per-device and per-browser; a database, user accounts and an API replace that without changing the three files above.

## What the platform gives you

A managed backend with a database, user sign-up and login, file storage, REST and GraphQL APIs and Cloud Code, so the same data serves this web app today and a native app later if you ever do go to a store. Documentation: [https://www.back4app.com/docs?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app](https://www.back4app.com/docs?utm_source=github&utm_medium=repo&utm_campaign=installable-web-app).

## License

MIT.
