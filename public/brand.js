/* THE BRAND, IN ONE PLACE.
   The launcher, the dashboard sign-in and the upload page all show the company before anyone
   has identified themselves, and each had the name hard-coded and no logo at all -- so
   changing the logo meant editing three files and shipping a deploy.

   They now read the same CALL_LOGO_URL / CALL_BRAND settings the phone app reads, through the
   public api_brand endpoint. Upload the logo once in Settings and every surface carries it.

   Until one is uploaded, the drawn HOPE mark stands in. Nothing here ever renders an <img>
   with an empty or failed src, because that is a broken-image icon, which looks worse than no
   logo at all.

   Deliberately ES5-plain and dependency-free: the Android WebView on the oldest handset in
   the field loads these pages. */
(function () {
  var MARK = '<svg viewBox="0 0 64 64" aria-hidden="true">'
    + '<text x="32" y="33" text-anchor="middle" font-size="21" font-weight="800"'
    + ' letter-spacing="-1.4" fill="#3B30E6">HOPE</text>'
    + '<path d="M18 38 A 14 14 0 0 0 46 38" fill="none" stroke="#3B30E6" stroke-width="5"'
    + ' stroke-linecap="round"/></svg>';

  var css = document.createElement('style');
  css.textContent = '.brandmark{width:64px;height:64px;border-radius:16px;background:#fff;'
    + 'margin:0 0 12px;padding:4px;display:block;box-sizing:border-box;'
    + 'box-shadow:0 1px 3px rgba(16,24,40,.10)}'
    + '.brandmark svg,.brandmark img{width:100%;height:100%;display:block;object-fit:contain}';
  document.head.appendChild(css);

  var spots = document.querySelectorAll('[data-brandmark]');
  if (!spots.length) return;
  for (var i = 0; i < spots.length; i++) {
    spots[i].className = (spots[i].className ? spots[i].className + ' ' : '') + 'brandmark';
    spots[i].innerHTML = MARK;
  }

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
