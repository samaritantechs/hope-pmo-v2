/* THE BRAND, IN ONE PLACE.
   The launcher, the dashboard sign-in and the upload page all show the company before anyone
   has identified themselves, and each had the name hard-coded and no logo at all -- so
   changing the logo meant editing three files and shipping a deploy.

   They now read the same CALL_LOGO_URL / CALL_BRAND settings the phone app reads, through the
   public api_brand endpoint. Upload the logo once and every surface carries it -- including
   the BROWSER TAB and the icon Android puts on the home screen when a page is added from the
   browser, which no page had at all: every one of them showed a blank default.

   (The icon on the APK's own home-screen entry is a different thing again. Android resolves
   that from inside the installed package, so it needs a build -- nothing served from here can
   reach it.)

   Until a logo is uploaded, the drawn HOPE mark stands in. Nothing here ever renders an <img>
   with an empty or failed src, because that is a broken-image icon, which looks worse than no
   logo at all.

   Deliberately ES5-plain and dependency-free: the Android WebView on the oldest handset in
   the field loads these pages.

   A page that fetches the brand itself (call.html does, inside boot) sets
   window.HOPE_NO_BRAND_FETCH = true and calls HOPEBrand.icon(url) from there, so the phone
   never makes the same round trip twice. */
(function () {
  var MARK = '<svg viewBox="0 0 64 64" aria-hidden="true">'
    + '<text x="32" y="33" text-anchor="middle" font-size="21" font-weight="800"'
    + ' letter-spacing="-1.4" fill="#3B30E6">HOPE</text>'
    + '<path d="M18 38 A 14 14 0 0 0 46 38" fill="none" stroke="#3B30E6" stroke-width="5"'
    + ' stroke-linecap="round"/></svg>';
  // The same mark as a standalone file, for the tab icon before anything is uploaded.
  var MARK_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<rect width="64" height="64" rx="14" fill="#fff"/>'
    + '<text x="32" y="33" text-anchor="middle" font-size="21" font-weight="800"'
    + ' letter-spacing="-1.4" fill="#3B30E6" font-family="Arial,Helvetica,sans-serif">HOPE</text>'
    + '<path d="M18 38 A 14 14 0 0 0 46 38" fill="none" stroke="#3B30E6" stroke-width="5"'
    + ' stroke-linecap="round"/></svg>');

  /** Points the tab icon, and the icon a browser uses for "add to home screen", at a URL. */
  function icon(url) {
    if (!url) return;
    var rels = ['icon', 'shortcut icon', 'apple-touch-icon'];
    for (var i = 0; i < rels.length; i++) {
      var links = document.querySelectorAll('link[rel="' + rels[i] + '"]');
      for (var j = 0; j < links.length; j++) links[j].parentNode.removeChild(links[j]);
      var l = document.createElement('link');
      l.rel = rels[i]; l.href = url;
      document.head.appendChild(l);
    }
  }
  window.HOPEBrand = { icon: icon, mark: MARK, markIcon: MARK_ICON };
  icon(MARK_ICON);                       // never a blank tab, even before an upload

  var css = document.createElement('style');
  css.textContent = '.brandmark{width:64px;height:64px;border-radius:16px;background:#fff;'
    + 'margin:0 0 12px;padding:4px;display:block;box-sizing:border-box;'
    + 'box-shadow:0 1px 3px rgba(16,24,40,.10)}'
    + '.brandmark svg,.brandmark img{width:100%;height:100%;display:block;object-fit:contain}';
  document.head.appendChild(css);

  var spots = document.querySelectorAll('[data-brandmark]');
  for (var i = 0; i < spots.length; i++) {
    spots[i].className = (spots[i].className ? spots[i].className + ' ' : '') + 'brandmark';
    spots[i].innerHTML = MARK;
  }
  if (window.HOPE_NO_BRAND_FETCH) return;

  try {
    fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn: 'api_brand', args: [] })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) return;
      if (d.brand) {
        var names = document.querySelectorAll('[data-brandname]');
        for (var j = 0; j < names.length; j++) names[j].textContent = d.brand;
      }
      if (!d.logo) return;
      // The mark is only replaced by an image that has actually LOADED.
      var im = new Image();
      im.onload = function () {
        icon(d.logo);
        for (var k = 0; k < spots.length; k++) {
          var c = spots[k]; c.innerHTML = '';
          var el = new Image(); el.src = d.logo; el.alt = d.brand || '';
          c.appendChild(el);
        }
      };
      im.src = d.logo;
    }).catch(function () { /* offline or the API is down -- the drawn mark stands */ });
  } catch (e) { /* no fetch on a very old WebView -- the drawn mark stands */ }
})();
