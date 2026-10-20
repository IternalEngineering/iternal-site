/* Walkthrough (dark launch only). Adding ?walkthrough to websites.html,
   start.html or questions.html lets the team step through every screen of
   the funnel without the gates that need real details: nothing is sent to
   the worker and no call is booked. It lasts for the browser tab;
   ?walkthrough=off ends it. Removed at light-up (HOUSEKEEPING.md §Go-live). */
var WALKTHROUGH = (function () {
  var m = location.search.match(/[?&]walkthrough(?:=(\w*))?/);
  var on = !!m && m[1] !== 'off';
  try {
    if (m) { if (on) sessionStorage.setItem('iternal_walkthrough', '1'); else sessionStorage.removeItem('iternal_walkthrough'); }
    on = sessionStorage.getItem('iternal_walkthrough') === '1';
  } catch (e) {}
  if (on) {
    var bar = document.createElement('div');
    bar.innerHTML = 'Walkthrough: nothing you enter is sent, and no call is booked. <a href="?walkthrough=off" style="color:inherit; margin-left:10px">End walkthrough</a>';
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;background:#0bafaa;color:#060f26;font-weight:700;font-size:13px;text-align:center;padding:8px 14px;letter-spacing:.02em';
    document.body.appendChild(bar);
  }
  return on;
})();
