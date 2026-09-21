// GitHub Pages can't send an X-Frame-Options or frame-ancestors header, and
// frame-ancestors is ignored when it comes from a <meta> CSP, so this is the
// only clickjacking defence a purely static site has: if the page finds
// itself inside someone else's frame, it takes the top window with it.
if (window.top !== window.self) {
  try {
    window.top.location = window.self.location.href;
  } catch (e) {
    // Cross-origin parent won't let us navigate it — blank the page instead
    // so there's nothing left worth framing.
    document.documentElement.textContent = '';
  }
}

// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Cookie notice (no tracking cookies used — just remembers dismissal locally)
try {
  const banner = document.getElementById('cookieBanner');
  const acceptBtn = document.getElementById('cookieAccept');
  if (banner && acceptBtn) {
    if (!localStorage.getItem('cookieNoticeDismissed')) {
      banner.hidden = false;
    }
    acceptBtn.addEventListener('click', () => {
      banner.hidden = true;
      try {
        localStorage.setItem('cookieNoticeDismissed', 'true');
      } catch (e) {
        /* localStorage unavailable — banner will just reappear next visit */
      }
    });
  }
} catch (e) {
  /* localStorage unavailable — skip the cookie notice entirely */
}
