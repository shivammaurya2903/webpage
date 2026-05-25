/* Luxury Tour & Travels - Vanilla JS */

(() => {
  const DEFAULT_API_PORT = '5000';
  const DEFAULT_TIMEOUT_MS = 12000;
  const API_RETRY_DELAY_MS = 500;

  const API_BASE = (() => {
    const override = window.__API_BASE__ || document.documentElement.dataset.apiBase;
    if (override) return String(override).replace(/\/$/, '');

    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      const { hostname, protocol } = window.location;

      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        const forcedPort = String(window.__API_PORT__ || document.documentElement.dataset.apiPort || DEFAULT_API_PORT).trim();
        if (forcedPort) return `${protocol}//${hostname}:${forcedPort}`;
      }

      return window.location.origin.replace(/\/$/, '');
    }

    return `http://localhost:${DEFAULT_API_PORT}`;
  })();

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${normalizedPath}`;
  }
  async function safeJson(response) {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (e) {
      return { message: text };
    }
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isNetworkFailure(error) {
    if (!error) return false;
    if (error.name === 'AbortError') return false;
    if (error instanceof TypeError) return true;
    const message = String(error.message || '').toLowerCase();
    return message.includes('failed to fetch') || message.includes('networkerror') || message.includes('load failed');
  }

  function isBrowserExtensionNoise(reason) {
    const text = String(reason?.message || reason?.stack || reason || '').toLowerCase();
    return (
      text.includes('listener indicated an asynchronous response')
      && text.includes('message channel closed before a response was received')
    ) || text.includes('listener indicated an asynchronous response')
      || text.includes('message channel closed before a response was received')
      || text.includes('async response')
      || text.includes('message channel closed');
  }

  function normalizeRequestError(error, url) {
    if (error?.name === 'AbortError') {
      return new Error(`Request timed out. Please try again. (${url})`);
    }

    if (isNetworkFailure(error)) {
      return new Error(`Unable to connect to server. Check backend status and API URL. (${url})`);
    }

    return error instanceof Error ? error : new Error('Unexpected request error');
  }

  async function performRequest(url, options = {}, requestOptions = {}) {
    const {
      timeoutMs = Number(document.documentElement.dataset.apiTimeout || window.__API_TIMEOUT__ || DEFAULT_TIMEOUT_MS),
      retries,
      retryDelayMs = API_RETRY_DELAY_MS
    } = requestOptions;

    const method = String(options.method || 'GET').toUpperCase();
    const maxRetries = Number.isInteger(retries) ? retries : (method === 'GET' ? 1 : 0);

    let attempt = 0;
    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        window.clearTimeout(timer);
        return response;
      } catch (error) {
        window.clearTimeout(timer);
        const normalizedError = normalizeRequestError(error, url);
        const canRetry = attempt < maxRetries && isNetworkFailure(error);
        if (!canRetry) throw normalizedError;
        await delay(retryDelayMs * (attempt + 1));
      }

      attempt += 1;
    }

    throw new Error(`Request failed after retries. (${url})`);
  }

  // Global error handlers to capture unhandled rejections and uncaught errors
  // These help avoid noisy console errors and provide a user-visible message.
  function showGlobalNotification(message, isError = true) {
    try {
      let el = document.querySelector('[data-global-notice]');
      if (!el) {
        el = document.createElement('div');
        el.dataset.globalNotice = '';
        el.style.position = 'fixed';
        el.style.right = '16px';
        el.style.top = '16px';
        el.style.zIndex = 9999;
        el.style.maxWidth = '320px';
        el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
        el.style.borderRadius = '8px';
        el.style.padding = '10px 14px';
        el.style.fontFamily = 'inherit';
        el.style.fontSize = '14px';
        el.style.color = '#fff';
        document.body.appendChild(el);
      }
      el.style.background = isError ? '#c0392b' : '#27ae60';
      el.textContent = message;
      // auto-dismiss
      window.setTimeout(() => { if (el) el.remove(); }, 6000);
    } catch (e) {
      // ignore
    }
  }

  window.addEventListener('unhandledrejection', (ev) => {
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    if (isBrowserExtensionNoise(ev?.reason)) return;
    console.error('Unhandled Promise Rejection:', ev.reason);
    showGlobalNotification('An unexpected error occurred. See console for details.');
  });

  window.addEventListener('error', (ev) => {
    if (isBrowserExtensionNoise(ev?.message || ev?.error?.message || '')) {
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      console.info('Ignored browser extension async listener warning:', ev.message || ev.error?.message);
      return;
    }
    console.error('Uncaught Error:', ev.error || ev.message, ev);
    showGlobalNotification('An unexpected error occurred. See console for details.');
  });
  const navbar = document.querySelector('[data-navbar]');
  const menuBtn = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-menu]');
  const navLinks = Array.from(document.querySelectorAll('.nav-links a, .mobile-menu a[href^="#"]'));

  // --- Simple frontend auth helpers (store JWT in localStorage) ---
  const AUTH_TOKEN_KEY = 'auth_token';
  const AUTH_USER_KEY = 'auth_user';

  function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
    if (!token) setUser(null);
    renderAuthButtons();
  }

  function setUser(user) {
    if (user) sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(AUTH_USER_KEY);
    renderAuthButtons();
  }

  function getUser() {
    try {
      const raw = sessionStorage.getItem(AUTH_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function authFetch(url, opts = {}, requestOptions = {}) {
    opts = { ...opts };
    opts.headers = opts.headers ? { ...opts.headers } : {};
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (!opts.headers.Accept) opts.headers.Accept = 'application/json';
    // include credentials in case backend relies on cookies
    opts.credentials = opts.credentials || 'include';
    return performRequest(url, opts, requestOptions);
  }

  function setFormSubmitting(form, isSubmitting, label) {
    if (!form) return null;
    const submitButton = form.querySelector('button[type="submit"]');
    if (!submitButton) return null;

    if (isSubmitting) {
      if (!submitButton.dataset.originalText) {
        submitButton.dataset.originalText = submitButton.textContent || '';
      }
      submitButton.disabled = true;
      submitButton.textContent = label;
    } else {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.originalText || submitButton.textContent || '';
      delete submitButton.dataset.originalText;
    }

    return submitButton;
  }

  // Render bookings into a modal
  let __lastBookings = [];
  function showBookingsModal(bookings) {
    try {
      __lastBookings = Array.isArray(bookings) ? bookings : [];
      const modal = document.getElementById('bookingsModal');
      const list = document.getElementById('bookingsList');
      const closeBtn = document.getElementById('bookingsCloseBtn');
      if (!modal || !list) return;
      list.innerHTML = '';
      if (!bookings || !bookings.length) {
        list.innerHTML = '<div class="card" style="padding:12px">No bookings found.</div>';
      } else {
        bookings.forEach((b, idx) => {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.padding = '12px';
          card.style.marginBottom = '8px';
          const fare = b.estimatedFare || b.amount || 0;
          const status = b.bookingStatus || b.paymentStatus || '';
          card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
              <div style="flex:1">
                <div style="font-weight:600">${escapeHtml(b.bookingId)} — ${escapeHtml(b.customerName || '')}</div>
                <div style="color:#666;margin-top:6px">${escapeHtml(b.pickupLocation || '')} → ${escapeHtml(b.dropLocation || '')}</div>
                <div style="color:#666;margin-top:6px;font-size:13px">Pickup: ${new Date(b.pickupDate).toLocaleDateString()} ${escapeHtml(b.pickupTime || '')}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:8px">
                <div style="font-weight:700">₹${fare}</div>
                <div style="font-size:13px;color:#333">${escapeHtml(status)}</div>
                <div>
                  <button class="btn btn-sm btn-ghost" data-view-idx="${idx}">View</button>
                </div>
              </div>
            </div>
          `;
          list.appendChild(card);
        });

        // attach handlers for view buttons
        list.querySelectorAll('[data-view-idx]').forEach((btn) => {
          btn.addEventListener('click', (ev) => {
            const idx = Number(btn.getAttribute('data-view-idx'));
            const booking = __lastBookings[idx];
            if (booking) showBookingDetail(booking);
          });
        });
      }
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      if (closeBtn && !closeBtn._bookingsHandler) {
        closeBtn.addEventListener('click', () => {
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
        });
        closeBtn._bookingsHandler = true;
      }
    } catch (e) {
      console.error('showBookingsModal error', e);
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function showBookingDetail(b) {
    try {
      const modal = document.getElementById('bookingsModal');
      const list = document.getElementById('bookingsList');
      if (!modal || !list) return;
      list.innerHTML = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'card';
      wrapper.style.padding = '14px';
      wrapper.style.maxHeight = '60vh';
      wrapper.style.overflow = 'auto';

      const rows = [
        ['Booking ID', b.bookingId],
        ['Customer', b.customerName || b.fullName || ''],
        ['Email', b.email || ''],
        ['Phone', b.phone || ''],
        ['From → To', `${b.pickupLocation || ''} → ${b.dropLocation || ''}`],
        ['Pickup', `${new Date(b.pickupDate).toLocaleDateString()} ${b.pickupTime || ''}`],
        ['Passengers', b.passengers || ''],
        ['Car', b.selectedCar || ''],
        ['Package', b.selectedPackage || ''],
        ['Estimated Fare', `₹${b.estimatedFare || ''}`],
        ['Booking Status', b.bookingStatus || 'Pending'],
        ['Payment Status', b.paymentStatus || 'Unpaid'],
        ['Invoice ID', b.invoiceId || b.invoice?.invoiceId || 'Pending'],
        ['Final Bill', b.finalBill?.totalAmount ? `₹${b.finalBill.totalAmount}` : `₹${b.totalFare || b.estimatedFare || ''}`],
        ['Payment Note', 'Payment after ride completion']
      ];

      const content = document.createElement('div');
      rows.forEach(([k, v]) => {
        const el = document.createElement('div');
        el.style.marginBottom = '8px';
        el.innerHTML = `<strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)} `;
        content.appendChild(el);
      });

      const rawPre = document.createElement('pre');
      rawPre.style.background = '#f6f6f6';
      rawPre.style.padding = '8px';
      rawPre.style.borderRadius = '6px';
      rawPre.style.overflow = 'auto';
      rawPre.textContent = JSON.stringify(b, null, 2);

      const actions = document.createElement('div');
      actions.style.marginTop = '12px';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-ghost';
      backBtn.textContent = 'Back to list';
      backBtn.addEventListener('click', () => showBookingsModal(__lastBookings));

      const closeBtn = document.getElementById('bookingsCloseBtn');
      const closeLocal = document.createElement('button');
      closeLocal.className = 'btn btn-ghost';
      closeLocal.style.marginLeft = '8px';
      closeLocal.textContent = 'Close';
      closeLocal.addEventListener('click', () => {
        const modalEl = document.getElementById('bookingsModal');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
      });

      actions.appendChild(backBtn);
      if (b.invoiceId || b.invoice?.invoiceId || b.invoiceGenerated) {
        const downloadInvoiceBtn = document.createElement('button');
        downloadInvoiceBtn.className = 'btn btn-primary';
        downloadInvoiceBtn.style.marginLeft = '8px';
        downloadInvoiceBtn.textContent = 'Download invoice';
        downloadInvoiceBtn.addEventListener('click', async () => {
          try {
            const response = await authFetch(apiUrl(`/api/bookings/${b._id}/invoice/download`), { method: 'GET' });
            if (!response.ok) throw new Error('Invoice download failed');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${b.invoiceId || b.invoice?.invoiceId || b.bookingId}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
          } catch (error) {
            alert(error.message || 'Invoice download failed');
          }
        });
        actions.appendChild(downloadInvoiceBtn);
      }
      actions.appendChild(closeLocal);

      wrapper.appendChild(content);
      wrapper.appendChild(rawPre);
      wrapper.appendChild(actions);
      list.appendChild(wrapper);
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    } catch (e) {
      console.error('showBookingDetail error', e);
    }
  }

  function renderAuthButtons() {
    const loginBtn = document.getElementById('loginOpenBtn');
    const registerBtn = document.getElementById('registerOpenBtn');
    const mobileLoginBtn = document.getElementById('mobileLoginOpenBtn');
    const mobileRegisterBtn = document.getElementById('mobileRegisterOpenBtn');
    const navRight = document.querySelector('.nav-right');
    const mobileAccount = document.querySelector('[data-mobile-account]');
    const mobileAvatar = document.querySelector('[data-mobile-avatar]');
    const mobileName = document.querySelector('[data-mobile-name]');
    const mobileEmail = document.querySelector('[data-mobile-email]');
    const mobileMyBookingsBtn = document.getElementById('mobileMyBookingsBtn');
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
    if (!navRight) return;

    const existingLogout = document.getElementById('logoutBtn');
    const existingMyBookings = document.getElementById('myBookingsBtn');

    const user = getUser();
    if (getToken()) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (registerBtn) registerBtn.style.display = 'none';
      if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
      if (mobileRegisterBtn) mobileRegisterBtn.style.display = 'none';
      if (mobileAccount) mobileAccount.classList.remove('is-hidden');

      if (!existingMyBookings) {
        const mb = document.createElement('button');
        mb.id = 'myBookingsBtn';
        mb.className = 'btn btn-ghost desktop-only-action';
        mb.type = 'button';
        mb.textContent = 'My Bookings';
        mb.addEventListener('click', async () => {
          try {
            const res = await authFetch(apiUrl('/api/bookings'), {}, { retries: 1 });
            const body = await safeJson(res);
            if (!res.ok) throw new Error(body?.message || 'Failed to fetch bookings');
            showBookingsModal(body.bookings || []);
          } catch (e) {
            showGlobalNotification(e.message || 'Failed to fetch bookings');
          }
        });
        navRight.insertBefore(mb, menuBtn);
      }

      if (mobileMyBookingsBtn) {
        mobileMyBookingsBtn.onclick = async () => {
          closeMenu();
          try {
            const res = await authFetch(apiUrl('/api/bookings'), {}, { retries: 1 });
            const body = await safeJson(res);
            if (!res.ok) throw new Error(body?.message || 'Failed to fetch bookings');
            showBookingsModal(body.bookings || []);
          } catch (e) {
            showGlobalNotification(e.message || 'Failed to fetch bookings');
          }
        };
      }

      if (!existingLogout) {
        const lb = document.createElement('button');
        lb.id = 'logoutBtn';
        lb.className = 'btn btn-ghost desktop-only-action';
        lb.type = 'button';
        lb.textContent = 'Logout';
        lb.addEventListener('click', () => {
          setToken(null);
          setUser(null);
          showGlobalNotification('Logged out', false);
        });
        navRight.insertBefore(lb, menuBtn);
      }

      if (mobileLogoutBtn) {
        mobileLogoutBtn.onclick = () => {
          closeMenu();
          setToken(null);
          setUser(null);
          showGlobalNotification('Logged out', false);
        };
      }

      // show user label
      let userLabel = document.getElementById('userLabel');
      if (!userLabel && user) {
        userLabel = document.createElement('button');
        userLabel.id = 'userLabel';
        userLabel.className = 'btn btn-ghost desktop-only-action';
        userLabel.type = 'button';
        userLabel.textContent = user.name || user.email || 'Me';
        navRight.insertBefore(userLabel, menuBtn);
      } else if (userLabel && user) {
        userLabel.textContent = user.name || user.email || 'Me';
      } else if (userLabel && !user) {
        userLabel.remove();
      }

      if (mobileAvatar) mobileAvatar.textContent = (user?.name || user?.email || 'Me').slice(0, 2).toUpperCase();
      if (mobileName) mobileName.textContent = user?.name || user?.email || 'My Account';
      if (mobileEmail) mobileEmail.textContent = user?.email || 'Manage bookings and profile';
    } else {
      if (loginBtn) loginBtn.style.display = '';
      if (registerBtn) registerBtn.style.display = '';
      if (mobileLoginBtn) mobileLoginBtn.style.display = '';
      if (mobileRegisterBtn) mobileRegisterBtn.style.display = '';
      if (existingMyBookings) existingMyBookings.remove();
      if (existingLogout) existingLogout.remove();
      const userLabel = document.getElementById('userLabel');
      if (userLabel) userLabel.remove();
      if (mobileAccount) mobileAccount.classList.add('is-hidden');
      if (mobileAvatar) mobileAvatar.textContent = 'Me';
      if (mobileName) mobileName.textContent = 'Guest';
      if (mobileEmail) mobileEmail.textContent = 'Sign in to manage your trips';
      if (mobileMyBookingsBtn) mobileMyBookingsBtn.onclick = null;
      if (mobileLogoutBtn) mobileLogoutBtn.onclick = null;
    }
  }

  // Initialize auth UI state
  renderAuthButtons();

  // Try to auto-login by fetching profile if token exists and no cached user
  async function fetchProfileOnLoad() {
    const token = getToken();
    if (!token) return;
    const cached = getUser();
    if (cached) return; // already have user info
    try {
      const res = await authFetch(apiUrl('/api/auth/profile'));
      const body = await safeJson(res);
      if (!res.ok || !body || !body.user) {
        // token likely invalid or expired
        setToken(null);
        setUser(null);
        return;
      }
      setUser(body.user);
    } catch (e) {
      console.error('Profile fetch failed', e);
      setToken(null);
      setUser(null);
    }
  }

  fetchProfileOnLoad();

  const setActiveLink = (id) => {
    if (!id) return;
    navLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const isActive = href === `#${id}`;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  const closeMenu = () => {
    if (!menuBtn || !menu) return;
    menu.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  };

  const openMenu = () => {
    if (!menuBtn || !menu) return;
    menu.classList.add('is-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-open');
  };

  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      const isOpen = menu.classList.contains('is-open');
      if (isOpen) closeMenu();
      else openMenu();
    });

    menu.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', () => closeMenu());
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });
  }

  const updateNavbarState = () => {
    navbar?.classList.toggle('is-scrolled', window.scrollY > 12);
  };

  const setMenuFromBreakpoint = () => {
    if (window.innerWidth > 992) closeMenu();
  };

  window.addEventListener('scroll', updateNavbarState, { passive: true });
  window.addEventListener('resize', setMenuFromBreakpoint);
  updateNavbarState();
  setMenuFromBreakpoint();

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.pushState(null, '', href);
    });
  });

  const revealEls = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  const sections = Array.from(document.querySelectorAll('section[id], footer[id]'));
  if ('IntersectionObserver' in window && sections.length) {
    const activeObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target?.id) setActiveLink(visible.target.id);
      },
      { rootMargin: '-24% 0px -62% 0px', threshold: [0.15, 0.3, 0.45, 0.6] }
    );

    sections.forEach((section) => activeObserver.observe(section));
  }

  const activeFromHash = () => {
    const id = window.location.hash.replace('#', '') || 'home';
    setActiveLink(id);
  };
  window.addEventListener('hashchange', activeFromHash);
  activeFromHash();

  const carousel = document.querySelector('[data-fleet-carousel]');
  if (carousel) {
    const track = carousel.querySelector('[data-fleet-track]');
    const cards = Array.from(carousel.querySelectorAll('[data-fleet-card]'));
    const prevBtn = carousel.querySelector('[data-fleet-prev]');
    const nextBtn = carousel.querySelector('[data-fleet-next]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let index = 0;
    let autoplayId = null;
    let isPointerDown = false;
    let startX = 0;

    const getGap = () => {
      const style = window.getComputedStyle(track);
      const gap = parseFloat(style.columnGap || style.gap || '18');
      return Number.isNaN(gap) ? 18 : gap;
    };

    const getStep = () => {
      if (!cards.length) return 0;
      return cards[0].getBoundingClientRect().width + getGap();
    };

    const getMaxIndex = () => Math.max(0, cards.length - 1);

    const update = (nextIndex, { loop = false } = {}) => {
      const maxIndex = getMaxIndex();
      if (!maxIndex && cards.length) {
        index = 0;
      } else if (loop) {
        // loop never show end: wrap around
        const wrapped = ((nextIndex % (maxIndex + 1)) + (maxIndex + 1)) % (maxIndex + 1);
        index = wrapped;
      } else {
        index = Math.max(0, Math.min(maxIndex, nextIndex));
      }

      const step = getStep();
      if (track) track.style.transform = `translateX(${-index * step}px)`;

      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;

      // mark active card for CSS animation
      cards.forEach((card, i) => {
        card.dataset.active = String(i === index);
      });
    };

    const advance = () => {
      const maxIndex = getMaxIndex();
      if (!maxIndex) return;
      update(index + 1, { loop: true });
    };

    const startAutoplay = () => {
      if (prefersReducedMotion || cards.length < 2 || autoplayId) return;
      autoplayId = window.setInterval(advance, 4500);
    };

    const stopAutoplay = () => {
      if (!autoplayId) return;
      window.clearInterval(autoplayId);
      autoplayId = null;
    };

    prevBtn?.addEventListener('click', () => update(index - 1, { loop: true }));
    nextBtn?.addEventListener('click', () => update(index + 1, { loop: true }));

    // Keyboard support (Left/Right) when carousel is focused
    // - Works even if buttons are not focused
    carousel.addEventListener('keydown', (event) => {
      if (!event || event.defaultPrevented) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stopAutoplay();
        update(index - 1, { loop: true });
        startAutoplay();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        stopAutoplay();
        update(index + 1, { loop: true });
        startAutoplay();
      }
    });

    // Make sure arrow buttons show correct disabled state when card count is 1
    // (update() will handle this, but this is a quick visual sync)
    if (cards.length < 2) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    }


    carousel.addEventListener('pointerdown', (event) => {
      isPointerDown = true;
      startX = event.clientX;
      stopAutoplay();
    });

    carousel.addEventListener('pointerup', (event) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      const delta = event.clientX - startX;
      if (Math.abs(delta) > 50) {
        update(delta < 0 ? index + 1 : index - 1, { loop: true });
      }
      startAutoplay();
    });

    carousel.addEventListener('pointerleave', () => {
      isPointerDown = false;
      startAutoplay();
    });

    carousel.addEventListener('focusin', stopAutoplay);
    carousel.addEventListener('focusout', startAutoplay);

    window.addEventListener('resize', () => update(index));
    update(0);
    startAutoplay();
  }

  // --- Auth modal behavior and form handlers ---
  const authModal = document.getElementById('authModal');
  const authCloseBtn = document.getElementById('authCloseBtn');
  const loginOpenBtn = document.getElementById('loginOpenBtn');
  const registerOpenBtn = document.getElementById('registerOpenBtn');
  const mobileLoginOpenBtn = document.getElementById('mobileLoginOpenBtn');
  const mobileRegisterOpenBtn = document.getElementById('mobileRegisterOpenBtn');

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showRegister = document.getElementById('showRegister');
  const showLogin = document.getElementById('showLogin');
  const authTitle = document.getElementById('authTitle');

  function openAuth(mode = 'login') {
    if (!authModal) return;
    authModal.classList.add('is-open');
    authModal.setAttribute('aria-hidden', 'false');

    if (mode === 'login') {
      loginForm?.classList.remove('is-hidden');
      registerForm?.classList.add('is-hidden');
      authTitle.textContent = 'Login';
    } else {
      loginForm?.classList.add('is-hidden');
      registerForm?.classList.remove('is-hidden');
      authTitle.textContent = 'Register';
    }
  }

  function closeAuth() {
    if (!authModal) return;
    authModal.classList.remove('is-open');
    authModal.setAttribute('aria-hidden', 'true');
  }


  authCloseBtn?.addEventListener('click', closeAuth);
  loginOpenBtn?.addEventListener('click', () => openAuth('login'));
  registerOpenBtn?.addEventListener('click', () => openAuth('register'));
  mobileLoginOpenBtn?.addEventListener('click', () => {
    closeMenu();
    openAuth('login');
  });
  mobileRegisterOpenBtn?.addEventListener('click', () => {
    closeMenu();
    openAuth('register');
  });
  showRegister?.addEventListener('click', () => openAuth('register'));
  showLogin?.addEventListener('click', () => openAuth('login'));


  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    setFormSubmitting(form, true, 'Logging in...');
    try {
      const res = await performRequest(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || !body.token) throw new Error((body && body.message) || 'Login failed');
      setToken(body.token);
      setUser(body.user || null);
      closeAuth();
      showGlobalNotification('Logged in successfully', false);
    } catch (err) {
      showGlobalNotification((err && err.message) || 'Login failed');
      console.error(err);
    } finally {
      setFormSubmitting(form, false);
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    setFormSubmitting(form, true, 'Creating account...');
    try {
      const res = await performRequest(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || !body.token) throw new Error((body && body.message) || 'Registration failed');
      setToken(body.token);
      setUser(body.user || null);
      closeAuth();
      showGlobalNotification('Registered and logged in', false);
    } catch (err) {
      showGlobalNotification((err && err.message) || 'Registration failed');
      console.error(err);
    } finally {
      setFormSubmitting(form, false);
    }
  });

  const supportForm = document.querySelector('[data-support-form]');
  if (supportForm) {
    const submitBtn = supportForm.querySelector('button[type="submit"]');
    const originalSubmitLabel = submitBtn?.innerHTML || 'Submit';

    const setSupportLoading = (loading) => {
      if (!submitBtn) return;
      submitBtn.disabled = loading;
      if (loading) submitBtn.classList.add('is-loading');
      else submitBtn.classList.remove('is-loading');
      submitBtn.innerHTML = loading
        ? '<span class="btn-spinner" aria-hidden="true"></span><span>Sending...</span>'
        : originalSubmitLabel;
    };

    const clearError = (input) => {
      const wrap = input?.closest('.field');
      if (!wrap) return;
      const error = wrap.querySelector('.error-msg');
      if (error) error.textContent = '';
      input.classList.remove('has-error');
    };

    const showError = (input, msg) => {
      const wrap = input?.closest('.field');
      if (!wrap) return;
      let error = wrap.querySelector('.error-msg');
      if (!error) {
        error = document.createElement('div');
        error.className = 'error-msg';
        wrap.appendChild(error);
      }
      error.textContent = msg;
      input.classList.add('has-error');
    };

    const isPhoneValid = (value) => /^\d{10}$/.test(String(value).replace(/\D/g, ''));

    const validate = () => {
      let ok = true;
      const name = supportForm.querySelector('[name="name"]');
      const email = supportForm.querySelector('[name="email"]');
      const phone = supportForm.querySelector('[name="phone"]');
      const message = supportForm.querySelector('[name="message"]');

      if (!name?.value || name.value.trim().length < 2) {
        showError(name, 'Please enter your name.');
        ok = false;
      } else clearError(name);

      if (!email?.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value.trim())) {
        showError(email, 'Please enter a valid email address.');
        ok = false;
      } else clearError(email);

      if (!isPhoneValid(phone?.value || '')) {
        showError(phone, 'Enter a valid 10-digit phone number.');
        ok = false;
      } else clearError(phone);

      if (!message?.value || message.value.trim().length < 8) {
        showError(message, 'Please write a short message (min 8 characters).');
        ok = false;
      } else clearError(message);

      return ok;
    };

    supportForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validate()) return;

      setSupportLoading(true);
      try {
        const payload = {
          name: supportForm.querySelector('[name="name"]').value.trim(),
          email: supportForm.querySelector('[name="email"]').value.trim(),
          phone: supportForm.querySelector('[name="phone"]').value.trim(),
          message: supportForm.querySelector('[name="message"]').value.trim(),
          subject: 'Support Request'
        };

        const response = await performRequest(apiUrl('/api/contact'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await safeJson(response);
        if (!response.ok || !result || !result.success) {
          throw new Error((result && result.message) || 'Failed to submit support request');
        }

        supportForm.querySelector('[data-support-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.supportStatus = '';
        status.textContent = 'Request sent! Our team will contact you shortly.';
        status.className = 'submit-status';
        supportForm.appendChild(status);
        supportForm.reset();
        document.querySelector('#support')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        supportForm.querySelector('[data-support-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.supportStatus = '';
        status.textContent = error.message || 'Failed to send request. Please try again.';
        status.className = 'submit-status';
        supportForm.appendChild(status);
      } finally {
        setSupportLoading(false);
      }
    });

    supportForm.querySelectorAll('input, textarea').forEach((el) => {
      el.addEventListener('focus', () => clearError(el));
      el.addEventListener('input', () => clearError(el));
      el.addEventListener('change', () => clearError(el));
    });
  }

  const form = document.querySelector('[data-booking-form]');
  if (form) {
    const submitBtn = form.querySelector('.submit-btn');
    const passengers = form.querySelector('[name="passengers"]');
    const email = form.querySelector('[name="email"]');
    const phone = form.querySelector('[name="phone"]');
    const fullName = form.querySelector('[name="fullName"]');
    const pickupLoc = form.querySelector('[name="pickupLocation"]');
    const dropLoc = form.querySelector('[name="dropLocation"]');
    const pickupDate = form.querySelector('[name="pickupDate"]');
    const dropDate = form.querySelector('[name="dropDate"]');
    const pickupTime = form.querySelector('[name="pickupTime"]');
    const vehicleSelect = form.querySelector('[data-vehicle-select]');
    const selectedCarName = form.querySelector('[data-selected-car]');
    const tripType = form.querySelector('[data-trip-type]');
    const selectedPackage = form.querySelector('[name="selectedPackage"]') || tripType;
    const pickupCoordinates = form.querySelector('[data-pickup-coordinates]');
    const dropCoordinates = form.querySelector('[data-drop-coordinates]');
    const pickupSuggestions = document.getElementById('pickupSuggestions');
    const dropSuggestions = document.getElementById('dropSuggestions');
    const fareDistance = document.querySelector('[data-fare-distance]');
    const fareDuration = document.querySelector('[data-fare-duration]');
    const fareBase = document.querySelector('[data-fare-base]');
    const fareRate = document.querySelector('[data-fare-rate]');
    const fareToll = document.querySelector('[data-fare-toll]');
    const fareGst = document.querySelector('[data-fare-gst]');
    const fareTotal = document.querySelector('[data-fare-total]');
    const fareSource = document.querySelector('[data-fare-source]');
    const routeNote = document.querySelector('[data-route-note]');
    const mapElement = document.getElementById('bookingMap');

    const currencyFormatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    });

    let quoteToken = 0;
    let quoteTimer = null;
    let pickupTimer = null;
    let dropTimer = null;
    let vehicles = [];
    let bookingMap = null;
    let bookingRouteLayer = null;
    let bookingPickupMarker = null;
    let bookingDropMarker = null;
    let isBookingSubmitting = false;

    const originalSubmitLabel = submitBtn?.innerHTML || 'Submit Booking';

    const getTodayDateValue = () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const parseDateValue = (value) => {
      const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(value || '').trim());
      if (!match) return null;

      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);

      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      return date;
    };

    const normalizeIndianPhone = (value) => {
      const cleaned = String(value || '').trim().replace(/[\s-]/g, '');
      if (!cleaned || /[^+0-9]/.test(cleaned)) return null;

      let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
      if (digits.startsWith('91') && digits.length === 12) {
        digits = digits.slice(2);
      }

      if (!/^[6-9][0-9]{9}$/.test(digits)) return null;
      return {
        digits,
        normalized: `+91${digits}`,
        display: `+91 ${digits}`
      };
    };

    const setBookingDateBounds = () => {
      const todayValue = getTodayDateValue();
      if (pickupDate) pickupDate.min = todayValue;
      if (dropDate) dropDate.min = pickupDate?.value && parseDateValue(pickupDate.value) ? pickupDate.value : todayValue;
    };

    const setFieldState = (input, valid, message = '') => {
      const wrap = input?.closest('.field');
      if (!wrap || !input) return valid;

      let error = wrap.querySelector('.error-msg');
      if (!error) {
        error = document.createElement('div');
        error.className = 'error-msg';
        wrap.appendChild(error);
      }

      input.classList.toggle('has-error', !valid);
      input.classList.toggle('is-valid', valid);
      if (valid) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
      error.textContent = valid ? '' : message;
      return valid;
    };

    const clearError = (input) => {
      const wrap = input?.closest('.field');
      if (!wrap || !input) return;
      const error = wrap.querySelector('.error-msg');
      if (error) error.textContent = '';
      input.classList.remove('has-error');
      input.classList.remove('is-valid');
      input.removeAttribute('aria-invalid');
    };

    const isBookingFormReady = () => {
      const today = parseDateValue(getTodayDateValue());
      const pickup = parseDateValue(pickupDate?.value);
      const drop = parseDateValue(dropDate?.value);
      return Boolean(
        String(fullName?.value || '').trim().length >= 2
        && /^\S+@\S+\.\S+$/.test(String(email?.value || '').trim())
        && normalizeIndianPhone(phone?.value)
        && pickupTime?.value
        && String(pickupLoc?.value || '').trim()
        && String(dropLoc?.value || '').trim()
        && passengers?.value
        && vehicleSelect?.value
        && selectedPackage?.value
        && pickup && today && pickup >= today
        && drop && pickup && drop >= pickup
      );
    };

    const updateSubmitState = () => {
      if (!submitBtn) return;
      submitBtn.disabled = isBookingSubmitting || !isBookingFormReady();
    };

    const validateBookingField = (input, showMessage = true) => {
      if (!input) return true;

      if (input === fullName) {
        const valid = String(input.value || '').trim().length >= 2;
        return showMessage ? setFieldState(input, valid, 'Please enter your full name.') : valid;
      }

      if (input === email) {
        const valid = /^\S+@\S+\.\S+$/.test(String(input.value || '').trim());
        return showMessage ? setFieldState(input, valid, 'Please enter a valid email address.') : valid;
      }

      if (input === phone) {
        const normalized = normalizeIndianPhone(input.value);
        if (normalized) {
          input.value = input.matches(':focus') ? normalized.digits : normalized.display;
          return showMessage ? setFieldState(input, true) : true;
        }
        return showMessage ? setFieldState(input, false, 'Please enter a valid Indian mobile number.') : false;
      }

      if (input === pickupTime) {
        const valid = Boolean(input.value);
        return showMessage ? setFieldState(input, valid, 'Pickup time is required.') : valid;
      }

      if (input === pickupLoc) {
        const valid = Boolean(String(input.value || '').trim());
        return showMessage ? setFieldState(input, valid, 'Pickup location is required.') : valid;
      }

      if (input === dropLoc) {
        const valid = Boolean(String(input.value || '').trim());
        return showMessage ? setFieldState(input, valid, 'Drop location is required.') : valid;
      }

      if (input === passengers) {
        const valid = Boolean(input.value);
        return showMessage ? setFieldState(input, valid, 'Select passenger count.') : valid;
      }

      if (input === pickupDate) {
        const selected = parseDateValue(input.value);
        const today = parseDateValue(getTodayDateValue());
        const valid = Boolean(selected && today && selected >= today);
        return showMessage ? setFieldState(input, valid, 'Booking date cannot be earlier than today.') : valid;
      }

      if (input === dropDate) {
        const pickup = parseDateValue(pickupDate?.value);
        const selected = parseDateValue(input.value);
        const valid = Boolean(selected && pickup && selected >= pickup);
        const message = pickup && selected && selected < pickup
          ? 'Drop date cannot be earlier than pickup date.'
          : 'Please select a valid drop date.';
        return showMessage ? setFieldState(input, valid, message) : valid;
      }

      if (input === vehicleSelect) {
        const valid = Boolean(input.value);
        return showMessage ? setFieldState(input, valid, 'Please select a vehicle.') : valid;
      }

      if (input === selectedPackage) {
        const valid = Boolean(input.value);
        return showMessage ? setFieldState(input, valid, 'Please select a package.') : valid;
      }

      return true;
    };

    const validateBookingForm = () => {
      setBookingDateBounds();
      let valid = true;

      [fullName, email, phone, pickupTime, pickupLoc, dropLoc, passengers, pickupDate, dropDate, vehicleSelect, selectedPackage].forEach((input) => {
        if (!validateBookingField(input, true)) valid = false;
      });

      if (pickupDate?.value && dropDate?.value) {
        const pickup = parseDateValue(pickupDate.value);
        const drop = parseDateValue(dropDate.value);
        if (pickup && drop && drop < pickup) {
          setFieldState(dropDate, false, 'Drop date cannot be earlier than pickup date.');
          valid = false;
        }
      }

      updateSubmitState();
      return valid;
    };

    const formatMoney = (value) => currencyFormatter.format(Number(value || 0));

    const setSubmitLoading = (loading) => {
      if (!submitBtn) return;
      isBookingSubmitting = loading;
      submitBtn.disabled = loading;
      submitBtn.classList.toggle('is-loading', loading);
      submitBtn.innerHTML = loading
        ? '<span class="btn-spinner" aria-hidden="true"></span><span>Submitting...</span>'
        : originalSubmitLabel;
      if (!loading) updateSubmitState();
    };

    const parseCoords = (value) => {
      if (!value) return null;
      const parts = String(value).split(',').map((item) => Number(item.trim()));
      if (parts.length >= 2 && parts.every(Number.isFinite)) return parts;
      return null;
    };

    const getTripTypeValue = () => tripType?.value || selectedPackage?.value || 'one-way';

    const updateSelectedCarName = () => {
      const option = vehicleSelect?.selectedOptions?.[0];
      if (selectedCarName) selectedCarName.value = option?.dataset?.carName || option?.textContent?.trim() || '';
    };

    const updateFarePanel = (quote) => {
      const breakdown = quote?.fareBreakdown || {};
      if (fareDistance) fareDistance.textContent = breakdown.distanceInKm ? `${Number(breakdown.distanceInKm).toFixed(1)} km` : '--';
      if (fareDuration) fareDuration.textContent = breakdown.estimatedDuration ? `${Math.max(1, Math.round(Number(breakdown.estimatedDuration)))} min` : '--';
      if (fareBase) fareBase.textContent = formatMoney(breakdown.baseFare || 0);
      if (fareRate) fareRate.textContent = formatMoney(breakdown.perKmRate || breakdown.extraKmRate || 0);
      if (fareToll) fareToll.textContent = formatMoney(breakdown.tollCharges || 0);
      if (fareGst) fareGst.textContent = formatMoney(breakdown.gstAmount || 0);
      if (fareTotal) fareTotal.textContent = formatMoney(quote?.totalFare || 0);
      if (fareSource) fareSource.textContent = quote?.source === 'openrouteservice' ? 'OpenRouteService' : 'Fallback route';
      if (routeNote) {
        routeNote.textContent = quote?.source === 'openrouteservice'
          ? 'Live route resolved with OpenRouteService.'
          : 'Fallback estimate used while live route data was unavailable.';
      }
    };

    const clearRouteMap = () => {
      if (bookingRouteLayer) {
        bookingRouteLayer.remove();
        bookingRouteLayer = null;
      }
      if (bookingPickupMarker) {
        bookingPickupMarker.remove();
        bookingPickupMarker = null;
      }
      if (bookingDropMarker) {
        bookingDropMarker.remove();
        bookingDropMarker = null;
      }
    };

    const ensureBookingMap = () => {
      if (bookingMap || !mapElement || !window.L) return bookingMap;
      bookingMap = window.L.map(mapElement, { scrollWheelZoom: false, zoomControl: true }).setView([26.8467, 80.9462], 11);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(bookingMap);
      return bookingMap;
    };

    const renderRoutePreview = (quote) => {
      if (!window.L || !quote) return;
      const map = ensureBookingMap();
      if (!map) return;

      const geometry = Array.isArray(quote.routeGeometry) ? quote.routeGeometry : [];
      const routePoints = geometry.map((point) => [Number(point[1]), Number(point[0])]).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
      const pickupPoint = Array.isArray(quote.pickup?.coordinates) ? [Number(quote.pickup.coordinates[1]), Number(quote.pickup.coordinates[0])] : null;
      const dropPoint = Array.isArray(quote.drop?.coordinates) ? [Number(quote.drop.coordinates[1]), Number(quote.drop.coordinates[0])] : null;

      clearRouteMap();

      const allPoints = [];
      if (pickupPoint && Number.isFinite(pickupPoint[0]) && Number.isFinite(pickupPoint[1])) {
        bookingPickupMarker = window.L.marker(pickupPoint).addTo(map).bindPopup('Pickup');
        allPoints.push(pickupPoint);
      }
      if (dropPoint && Number.isFinite(dropPoint[0]) && Number.isFinite(dropPoint[1])) {
        bookingDropMarker = window.L.marker(dropPoint).addTo(map).bindPopup('Drop');
        allPoints.push(dropPoint);
      }
      if (routePoints.length >= 2) {
        bookingRouteLayer = window.L.polyline(routePoints, { color: '#6a1b9a', weight: 5, opacity: 0.92 }).addTo(map);
        allPoints.push(...routePoints);
      }

      if (allPoints.length) {
        map.fitBounds(window.L.latLngBounds(allPoints), { padding: [20, 20] });
      }

      window.setTimeout(() => map.invalidateSize(), 100);
    };

    const populateVehicles = async () => {
      if (!vehicleSelect) return;
      try {
        const response = await performRequest(apiUrl('/api/cars'));
        const data = await safeJson(response);
        vehicles = Array.isArray(data?.cars) ? data.cars : [];
        vehicleSelect.innerHTML = vehicles.length
          ? '<option value="" selected disabled>Select Vehicle</option>'
          : '<option value="" selected disabled>No vehicles available</option>';

        vehicles.forEach((car, index) => {
          const option = document.createElement('option');
          option.value = car._id || car.carName || String(index);
          option.dataset.carName = car.carName || '';
          option.textContent = `${car.carName || 'Vehicle'} · ${formatMoney(car.baseFare || car.pricePerDay || 0)}`;
          vehicleSelect.appendChild(option);
        });

        if (vehicles.length) {
          vehicleSelect.value = vehicles[0]._id || vehicles[0].carName || '';
          updateSelectedCarName();
        }
      } catch (error) {
        console.warn('Failed to load vehicles for fare calculation', error);
        if (vehicleSelect && !vehicleSelect.options.length) {
          vehicleSelect.innerHTML = '<option value="" selected disabled>Unable to load vehicles</option>';
        }
      }
    };

    const refreshLocationSuggestions = async (input, datalist, coordField) => {
      const query = String(input?.value || '').trim();
      if (!query || query.length < 3 || !datalist) return;

      try {
        const response = await performRequest(apiUrl(`/api/fare/geocode?query=${encodeURIComponent(query)}&limit=5`));
        const result = await safeJson(response);
        const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
        datalist.innerHTML = suggestions.map((item) => `<option value="${escapeHtml(item.label || query)}"></option>`).join('');

        const exactMatch = suggestions.find((item) => String(item.label || '').toLowerCase() === query.toLowerCase()) || suggestions[0];
        if (exactMatch?.coordinates && coordField) {
          coordField.value = exactMatch.coordinates.join(',');
        }
      } catch (error) {
        console.warn('Location suggestion lookup failed', error);
      }
    };

    const debounceQuote = () => {
      window.clearTimeout(quoteTimer);
      quoteTimer = window.setTimeout(() => {
        void calculateQuote();
      }, 450);
    };

    const calculateQuote = async () => {
      const pickupValue = String(pickupLoc?.value || '').trim();
      const dropValue = String(dropLoc?.value || '').trim();
      const vehicleId = String(vehicleSelect?.value || '').trim();

      if (!pickupValue || !dropValue || !vehicleId) {
        updateFarePanel(null);
        clearRouteMap();
        return null;
      }

      const token = ++quoteToken;
      if (fareSource) fareSource.textContent = 'Calculating...';

      try {
        const payload = {
          pickup: {
            address: pickupValue,
            coordinates: parseCoords(pickupCoordinates?.value)
          },
          drop: {
            address: dropValue,
            coordinates: parseCoords(dropCoordinates?.value)
          },
          vehicleId,
          selectedCar: selectedCarName?.value || '',
          tripType: getTripTypeValue(),
          pickupDateTime: pickupDate?.value && pickupTime?.value ? `${pickupDate.value}T${pickupTime.value}` : undefined,
          waitingMinutes: 0,
          tollCharges: 0
        };

        const response = await performRequest(apiUrl('/api/fare/calculate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await safeJson(response);

        if (token !== quoteToken) return null;
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || 'Failed to calculate fare');
        }

        updateFarePanel(result);
        renderRoutePreview({ ...result, pickup: payload.pickup, drop: payload.drop });
        return result;
      } catch (error) {
        if (token !== quoteToken) return null;
        updateFarePanel(null);
        if (routeNote) routeNote.textContent = error.message || 'Unable to calculate fare right now.';
        clearRouteMap();
        return null;
      }
    };

    const validate = () => validateBookingForm();

    const resetBookingState = () => {
      pickupCoordinates.value = '';
      dropCoordinates.value = '';
      if (pickupSuggestions) pickupSuggestions.innerHTML = '';
      if (dropSuggestions) dropSuggestions.innerHTML = '';
      form.querySelectorAll('input, select, textarea').forEach((element) => clearError(element));
      updateFarePanel(null);
      clearRouteMap();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validate()) return;

      const section = document.querySelector('#booking');
      setSubmitLoading(true);

      try {
        const payload = {
          customerName: fullName.value.trim(),
          email: email.value.trim(),
          phone: normalizeIndianPhone(phone.value)?.normalized || phone.value.trim(),
          pickupLocation: pickupLoc.value.trim(),
          dropLocation: dropLoc.value.trim(),
          pickupDate: pickupDate.value,
          dropDate: dropDate.value,
          pickupTime: pickupTime.value,
          passengers: passengers.value,
          selectedCar: selectedCarName?.value || selectedPackage?.value || '',
          vehicleId: vehicleSelect.value,
          tripType: getTripTypeValue(),
          selectedPackage: selectedPackage.value,
          pickupCoordinates: pickupCoordinates.value,
          dropCoordinates: dropCoordinates.value,
          specialRequirements: form.querySelector('[name="requirements"]')?.value.trim() || ''
        };

        const bookingResponse = await authFetch(apiUrl('/api/bookings'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const bookingResult = await safeJson(bookingResponse);
        if (!bookingResponse.ok || !bookingResult || !bookingResult.success) {
          throw new Error((bookingResult && bookingResult.message) || 'Failed to create booking');
        }

        form.querySelector('[data-submit-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.submitStatus = '';
        const bookingId = bookingResult.booking?.bookingId || 'Pending';
        const bookingStatus = bookingResult.booking?.bookingStatus || 'Pending';
        status.textContent = `Booking ${bookingId} submitted successfully. Status: ${bookingStatus}. Estimated total: ${formatMoney(bookingResult.booking?.totalFare || bookingResult.booking?.estimatedFare || 0)}.`;
        status.className = 'submit-status';
        form.appendChild(status);
        form.reset();
        resetBookingState();
        if (vehicles.length) {
          vehicleSelect.value = vehicles[0]._id || vehicles[0].carName || '';
          updateSelectedCarName();
        }
        setBookingDateBounds();
        updateSubmitState();
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        form.querySelector('[data-submit-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.submitStatus = '';
        status.textContent = error.message || 'Failed to submit booking. Please try again.';
        status.className = 'submit-status';
        form.appendChild(status);
      } finally {
        setSubmitLoading(false);
      }
    });

    setBookingDateBounds();
    updateSubmitState();

    if (phone) {
      phone.placeholder = '+91 9876543210';
      phone.autocomplete = 'tel-national';
      phone.inputMode = 'numeric';
      phone.addEventListener('input', () => {
        const sanitized = String(phone.value || '').replace(/[\s-]/g, '');
        if (sanitized !== phone.value) phone.value = sanitized;
        validateBookingField(phone, true);
        updateSubmitState();
      });
      phone.addEventListener('blur', () => {
        const normalized = normalizeIndianPhone(phone.value);
        if (normalized) phone.value = normalized.display;
        validateBookingField(phone, true);
        updateSubmitState();
      });
    }

    form.querySelectorAll('input, select, textarea').forEach((element) => {
      element.addEventListener('focus', () => clearError(element));
      element.addEventListener('input', () => {
        validateBookingField(element, true);
        updateSubmitState();
      });
      element.addEventListener('change', () => {
        validateBookingField(element, true);
        updateSubmitState();
      });
      element.addEventListener('blur', () => {
        validateBookingField(element, true);
        updateSubmitState();
      });
    });

    [pickupDate, dropDate].forEach((dateInput) => {
      if (!dateInput) return;
      dateInput.addEventListener('change', () => {
        setBookingDateBounds();
        if (dateInput === pickupDate && dropDate?.value) {
          const pickup = parseDateValue(pickupDate.value);
          const drop = parseDateValue(dropDate.value);
          if (pickup && drop && drop < pickup) {
            dropDate.value = '';
            showError(dropDate, 'Drop date cannot be earlier than pickup date.');
          }
        }
        validateBookingField(dateInput, true);
        updateSubmitState();
      });
    });

    [fullName, email, pickupTime, pickupLoc, dropLoc, passengers, vehicleSelect, selectedPackage].forEach((element) => {
      if (!element) return;
      element.addEventListener('input', () => updateSubmitState());
      element.addEventListener('change', () => updateSubmitState());
    });

    [pickupLoc, dropLoc].forEach((input, index) => {
      const datalist = index === 0 ? pickupSuggestions : dropSuggestions;
      const coordField = index === 0 ? pickupCoordinates : dropCoordinates;
      const timerRef = index === 0 ? 'pickupTimer' : 'dropTimer';

      const scheduleAutocomplete = () => {
        window.clearTimeout(index === 0 ? pickupTimer : dropTimer);
        if (index === 0) pickupTimer = window.setTimeout(() => void refreshLocationSuggestions(input, datalist, coordField), 350);
        else dropTimer = window.setTimeout(() => void refreshLocationSuggestions(input, datalist, coordField), 350);
      };

      input.addEventListener('input', scheduleAutocomplete);
      input.addEventListener('change', async () => {
        await refreshLocationSuggestions(input, datalist, coordField);
        debounceQuote();
      });
      input.addEventListener('blur', async () => {
        await refreshLocationSuggestions(input, datalist, coordField);
        debounceQuote();
      });
    });

    [vehicleSelect, selectedPackage, tripType, pickupDate, pickupTime].forEach((element) => {
      if (!element) return;
      element.addEventListener('change', () => {
        updateSelectedCarName();
        debounceQuote();
      });
      element.addEventListener('input', () => {
        updateSelectedCarName();
        debounceQuote();
      });
    });

    [pickupLoc, dropLoc].forEach((element) => {
      if (!element) return;
      element.addEventListener('change', debounceQuote);
      element.addEventListener('blur', debounceQuote);
    });

    void populateVehicles().then(() => {
      updateSelectedCarName();
      debounceQuote();
    });
    if (window.L) {
      ensureBookingMap();
    }
  }

  document.querySelectorAll('[data-ripple]').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (button.disabled) return;
      const rect = button.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.left = `${x}px`;
      span.style.top = `${y}px`;

      button.appendChild(span);
      window.setTimeout(() => span.remove(), 650);
    });
  });

  const paymentStatus = new URLSearchParams(window.location.search).get('payment');
  if (paymentStatus === 'success') {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
  }
})();

