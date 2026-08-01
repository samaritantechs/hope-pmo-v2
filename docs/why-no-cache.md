# Why every page says "no-cache"

*(This explains the `headers` block in `vercel.json`. It lives here rather than as a comment in
that file because Vercel validates `vercel.json` strictly, and an unrecognised key there can
fail the build — which on this system means taking the live site down to explain something.)*

## The problem it fixes

Every screen in this system is **one HTML file**. The whole app is inside the page, not in a
bundle beside it. When the page is old, the app is old.

Before this, nothing told a browser how long to keep that page — so each browser decided for
itself, and they all decide generously. The Android app is the worst case: its WebView runs on
`LOAD_DEFAULT` (`android/app/src/main/java/.../MainActivity.java`), which means *keep using what
you have until it looks expired*. With no expiry given, it never quite does.

So a fix could be written, merged, deployed, and confirmed live on the web — and the people who
needed it would still not have it. The Append / Replace choice on the upload page shipped in
**#48** and still had not appeared on the handsets that needed it, weeks later. The code was
right and the screen was wrong.

That is a nasty failure to debug from a chair, because everything you can check says it works.

## What `no-cache` actually means

It does **not** mean "do not store". It means:

> Keep the copy. But ask the server before you use it.

The server normally answers **304 Not Modified** — a few hundred bytes of headers, no page body.
So the cost is one small round trip per page load, and the benefit is that a deploy reaches
every phone on the next launch, instead of whenever the browser happens to feel like it.

If we had wanted "do not store", that would be `no-store`, and it would re-download the whole
page every time. We do not want that, and we are not doing it.

## What is covered

The HTML pages and `brand.js`. Everything else — the API responses, the APK download — is
unaffected and keeps whatever caching it had.

## How to tell if someone is on a stale page

The upload page prints its own age at the bottom ("Page version: …"). That comes from
`document.lastModified`, which is the browser's own record of when it got the file — so a stale
page reports a stale date and cannot lie about it. A version number printed into the page would
have been useless here: a stale page would carry a stale version number too.

If the date shown is older than a fix someone was told about, they are on an old copy: close the
app and reopen it.
