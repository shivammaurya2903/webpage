/* Luxury Tour & Travels - Vanilla JS */

(() => {
  const API_BASE = window.location.origin;
  async function safeJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // no JSON body
      return null;
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
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
    console.error('Unhandled Promise Rejection:', ev.reason);
    showGlobalNotification('An unexpected error occurred. See console for details.');
  });

  window.addEventListener('error', (ev) => {
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

  function authFetch(url, opts = {}) {
    opts = { ...opts };
    opts.headers = opts.headers ? { ...opts.headers } : {};
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    // include credentials in case backend relies on cookies
    opts.credentials = opts.credentials || 'include';
    return fetch(url, opts);
  }

  // Render bookings into a modal
  function showBookingsModal(bookings) {
    try {
      const modal = document.getElementById('bookingsModal');
      const list = document.getElementById('bookingsList');
      const closeBtn = document.getElementById('bookingsCloseBtn');
      if (!modal || !list) return;
      list.innerHTML = '';
      if (!bookings || !bookings.length) {
        list.innerHTML = '<div class="card" style="padding:12px">No bookings found.</div>';
      } else {
        bookings.forEach((b) => {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.padding = '12px';
          card.style.marginBottom = '8px';
          card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1">
                <div style="font-weight:600">${b.bookingId} — ${b.customerName}</div>
                <div style="color:#666;margin-top:6px">${b.pickupLocation} → ${b.dropLocation}</div>
                <div style="color:#666;margin-top:6px;font-size:13px">Pickup: ${new Date(b.pickupDate).toLocaleDateString()} ${b.pickupTime || ''}</div>
              </div>
              <div style="text-align:right;margin-left:12px">
                <div style="font-weight:700">₹${b.estimatedFare || b.amount || 0}</div>
                <div style="font-size:13px;color:#333;margin-top:6px">${b.bookingStatus || b.paymentStatus || ''}</div>
              </div>
            </div>
          `;
          list.appendChild(card);
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

  function renderAuthButtons() {
    const loginBtn = document.getElementById('loginOpenBtn');
    const registerBtn = document.getElementById('registerOpenBtn');
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;

    const existingLogout = document.getElementById('logoutBtn');
    const existingMyBookings = document.getElementById('myBookingsBtn');

    const user = getUser();
    if (getToken()) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (registerBtn) registerBtn.style.display = 'none';

      if (!existingMyBookings) {
        const mb = document.createElement('button');
        mb.id = 'myBookingsBtn';
        mb.className = 'btn btn-ghost';
        mb.type = 'button';
        mb.textContent = 'My Bookings';
        mb.addEventListener('click', async () => {
          try {
            const res = await authFetch(`${API_BASE}/api/bookings`);
            const body = await safeJson(res);
            if (!res.ok) throw new Error(body?.message || 'Failed to fetch bookings');
            showBookingsModal(body.bookings || []);
          } catch (e) {
            showGlobalNotification(e.message || 'Failed to fetch bookings');
          }
        });
        navRight.insertBefore(mb, menuBtn);
      }

      if (!existingLogout) {
        const lb = document.createElement('button');
        lb.id = 'logoutBtn';
        lb.className = 'btn btn-ghost';
        lb.type = 'button';
        lb.textContent = 'Logout';
        lb.addEventListener('click', () => {
          setToken(null);
          setUser(null);
          showGlobalNotification('Logged out', false);
        });
        navRight.insertBefore(lb, menuBtn);
      }

      // show user label
      let userLabel = document.getElementById('userLabel');
      if (!userLabel && user) {
        userLabel = document.createElement('button');
        userLabel.id = 'userLabel';
        userLabel.className = 'btn btn-ghost';
        userLabel.type = 'button';
        userLabel.textContent = user.name || user.email || 'Me';
        navRight.insertBefore(userLabel, menuBtn);
      } else if (userLabel && user) {
        userLabel.textContent = user.name || user.email || 'Me';
      } else if (userLabel && !user) {
        userLabel.remove();
      }
    } else {
      if (loginBtn) loginBtn.style.display = '';
      if (registerBtn) registerBtn.style.display = '';
      if (existingMyBookings) existingMyBookings.remove();
      if (existingLogout) existingLogout.remove();
      const userLabel = document.getElementById('userLabel');
      if (userLabel) userLabel.remove();
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
      const res = await authFetch(`${API_BASE}/api/auth/profile`);
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

    const update = (nextIndex) => {
      index = Math.max(0, Math.min(getMaxIndex(), nextIndex));
      const step = getStep();
      if (track) track.style.transform = `translateX(${-index * step}px)`;

      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === getMaxIndex();
    };

    const advance = () => {
      const maxIndex = getMaxIndex();
      if (!maxIndex) return;
      update(index >= maxIndex ? 0 : index + 1);
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

    prevBtn?.addEventListener('click', () => update(index - 1));
    nextBtn?.addEventListener('click', () => update(index + 1));

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
        update(delta < 0 ? index + 1 : index - 1);
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
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showRegister = document.getElementById('showRegister');
  const showLogin = document.getElementById('showLogin');
  const authTitle = document.getElementById('authTitle');

  function openAuth(mode = 'login') {
    if (!authModal) return;
    authModal.style.display = 'flex';
    authModal.setAttribute('aria-hidden', 'false');
    if (mode === 'login') {
      loginForm.style.display = 'block';
      registerForm.style.display = 'none';
      authTitle.textContent = 'Login';
    } else {
      loginForm.style.display = 'none';
      registerForm.style.display = 'block';
      authTitle.textContent = 'Register';
    }
  }

  function closeAuth() {
    if (!authModal) return;
    authModal.style.display = 'none';
    authModal.setAttribute('aria-hidden', 'true');
  }

  authCloseBtn?.addEventListener('click', closeAuth);
  loginOpenBtn?.addEventListener('click', () => openAuth('login'));
  registerOpenBtn?.addEventListener('click', () => openAuth('register'));
  showRegister?.addEventListener('click', () => openAuth('register'));
  showLogin?.addEventListener('click', () => openAuth('login'));

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || !body.token) throw new Error(body?.message || 'Login failed');
      setToken(body.token);
      closeAuth();
      showGlobalNotification('Logged in successfully', false);
    } catch (err) {
      showGlobalNotification(err.message || 'Login failed');
      console.error(err);
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || !body.token) throw new Error(body?.message || 'Registration failed');
      setToken(body.token);
      closeAuth();
      showGlobalNotification('Registered and logged in', false);
    } catch (err) {
      showGlobalNotification(err.message || 'Registration failed');
      console.error(err);
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

        const response = await fetch(`${API_BASE}/api/contact`, {
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
    const selectedCar = form.querySelector('[name="selectedCar"]');
    const selectedPackage = form.querySelector('[name="selectedPackage"]');

    const originalSubmitLabel = submitBtn?.innerHTML || 'Submit Booking';

    const setSubmitLoading = (loading) => {
      if (!submitBtn) return;
      submitBtn.disabled = loading;
      submitBtn.classList.toggle('is-loading', loading);
      submitBtn.innerHTML = loading
        ? '<span class="btn-spinner" aria-hidden="true"></span><span>Submitting...</span>'
        : originalSubmitLabel;
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

    const clearError = (input) => {
      const wrap = input?.closest('.field');
      if (!wrap) return;
      const error = wrap.querySelector('.error-msg');
      if (error) error.textContent = '';
      input.classList.remove('has-error');
    };

    const isPhoneValid = (value) => /^\d{10}$/.test(String(value).replace(/\D/g, ''));

    const toDate = (value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const validate = () => {
      let ok = true;

      if (!fullName?.value.trim() || fullName.value.trim().length < 2) {
        showError(fullName, 'Please enter your full name.');
        ok = false;
      } else clearError(fullName);

      if (!email?.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value.trim())) {
        showError(email, 'Please enter a valid email address.');
        ok = false;
      } else clearError(email);

      if (!isPhoneValid(phone?.value.trim())) {
        showError(phone, 'Enter a valid 10-digit phone number.');
        ok = false;
      } else clearError(phone);

      if (!pickupTime?.value) {
        showError(pickupTime, 'Pickup time is required.');
        ok = false;
      } else clearError(pickupTime);

      if (!pickupLoc?.value.trim()) {
        showError(pickupLoc, 'Pickup location is required.');
        ok = false;
      } else clearError(pickupLoc);

      if (!dropLoc?.value.trim()) {
        showError(dropLoc, 'Drop location is required.');
        ok = false;
      } else clearError(dropLoc);

      if (!passengers?.value) {
        showError(passengers, 'Select passenger count.');
        ok = false;
      } else clearError(passengers);

      if (!pickupDate?.value) {
        showError(pickupDate, 'Pickup date is required.');
        ok = false;
      } else clearError(pickupDate);

      if (!dropDate?.value) {
        showError(dropDate, 'Drop date is required.');
        ok = false;
      } else clearError(dropDate);

      if (!selectedCar?.value) {
        showError(selectedCar, 'Please select a car.');
        ok = false;
      } else clearError(selectedCar);

      if (!selectedPackage?.value) {
        showError(selectedPackage, 'Please select a package.');
        ok = false;
      } else clearError(selectedPackage);

      const pickup = toDate(pickupDate?.value);
      const drop = toDate(dropDate?.value);
      if (pickup && drop && drop < pickup) {
        showError(dropDate, 'Drop date cannot be earlier than pickup date.');
        ok = false;
      }

      return ok;
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
          phone: phone.value.trim(),
          pickupLocation: pickupLoc.value.trim(),
          dropLocation: dropLoc.value.trim(),
          pickupDate: pickupDate.value,
          pickupTime: pickupTime.value,
          passengers: passengers.value,
          selectedCar: selectedCar.value,
          selectedPackage: selectedPackage.value,
          specialRequirements: form.querySelector('[name="requirements"]')?.value.trim() || ''
        };

        const bookingResponse = await fetch(`${API_BASE}/api/bookings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const bookingResult = await safeJson(bookingResponse);
        if (!bookingResponse.ok || !bookingResult || !bookingResult.success) {
          throw new Error((bookingResult && bookingResult.message) || 'Failed to create booking');
        }

        const booking = bookingResult.booking;
        const paymentResponse = await fetch(`${API_BASE}/api/payment/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId: booking.bookingId, paymentType: 'advance' })
        });

        const paymentResult = await safeJson(paymentResponse);
        if (paymentResult && paymentResult.checkoutUrl) {
          window.location.href = paymentResult.checkoutUrl;
          return;
        }

        form.querySelector('[data-submit-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.submitStatus = '';
        status.textContent = `Booking created. Advance amount: ₹${booking.bookingAdvance}. Please contact support to complete payment.`;
        status.className = 'submit-status';
        form.appendChild(status);
        form.reset();
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

    form.querySelectorAll('input, select, textarea').forEach((element) => {
      element.addEventListener('focus', () => clearError(element));
      element.addEventListener('input', () => clearError(element));
      element.addEventListener('change', () => clearError(element));
    });
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
  const paymentSessionId = new URLSearchParams(window.location.search).get('session_id');

  if (paymentStatus === 'success' && paymentSessionId) {
    const bookingSection = document.querySelector('#booking .container');
    const notice = document.createElement('div');
    notice.className = 'submit-status';
    notice.textContent = 'Verifying your payment...';
    bookingSection?.prepend(notice);

    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/payment/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: paymentSessionId })
        });
        const body = await safeJson(response);
        if (!response.ok || !body || !body.success) throw new Error((body && body.message) || 'Payment verification failed');
        notice.textContent = 'Payment verified. Your booking is confirmed and our team has been notified.';
      } catch (error) {
        notice.textContent = error.message || 'Payment verification failed. Please contact support.';
      }
    })();
  }
})();

