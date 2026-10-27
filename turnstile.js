/* Cloudflare Turnstile, the bot check on forms marked data-turnstile (the
   sign-up on start.html). The worker checks the token with Cloudflare once
   TURNSTILE_SECRET is set on it.
   SITE_KEY is public. While it is empty no widget loads and the forms send no
   token, so set it here (and deploy) before setting the secret, never after. */
(function () {
  var SITE_KEY = '';
  window.turnstileToken = function (form) {
    var input = form.querySelector('[name="cf-turnstile-response"]');
    return input ? input.value : '';
  };
  // A token works once: after any refused or failed send, ask for a fresh one.
  window.turnstileReset = function () {
    try { if (window.turnstile) window.turnstile.reset(); } catch (e) {}
  };
  if (!SITE_KEY) return;
  document.querySelectorAll('form[data-turnstile]').forEach(function (form) {
    var box = document.createElement('div');
    box.className = 'cf-turnstile';
    box.setAttribute('data-sitekey', SITE_KEY);
    // Shown only if Cloudflare wants the visitor to click; invisible otherwise.
    box.setAttribute('data-appearance', 'interaction-only');
    var submit = form.querySelector('[type="submit"]');
    submit.parentNode.insertBefore(box, submit);
  });
  var script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async = true;
  document.head.appendChild(script);
})();
