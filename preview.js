/* Dark launch only: removed at light-up (HOUSEKEEPING.md §Go-live, step 4).
   Until then start.html and questions.html are a preview: every screen can be
   stepped through, but nothing is sent and no call is booked, and a banner
   says so. ?team switches to the real sign-up for the browser tab, for
   testing; ?team=off switches back. */
var PREVIEW = (function () {
  var m = location.search.match(/[?&]team(?:=(\w*))?/);
  var team = !!m && m[1] !== 'off';
  try {
    if (m) { if (team) sessionStorage.setItem('iternal_team', '1'); else sessionStorage.removeItem('iternal_team'); }
    team = sessionStorage.getItem('iternal_team') === '1';
  } catch (e) {}
  if (!team) {
    var bar = document.createElement('div');
    bar.textContent = 'Sign-ups and call bookings aren’t live yet.';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;background:#e0a614;color:#060f26;font-weight:700;font-size:13px;text-align:center;padding:8px 14px;letter-spacing:.02em';
    document.body.appendChild(bar);
  }
  return !team;
})();
