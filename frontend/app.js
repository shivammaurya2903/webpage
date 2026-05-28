/* Luxury Tour & Travels - Vanilla JS */

(() => {
  const APP_CONFIG = window.APP_CONFIG || {};
  const FALLBACK_API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://webpage-96yf.onrender.com';
  const API_BASE_URL = String(APP_CONFIG.API_BASE_URL || window.API_BASE_URL || FALLBACK_API_BASE_URL).replace(/\/$/, '');
  const SOCKET_BASE_URL = String(APP_CONFIG.SOCKET_BASE_URL || window.SOCKET_BASE_URL || API_BASE_URL).replace(/\/$/, '');
  const DEFAULT_TIMEOUT_MS = Number(APP_CONFIG.DEFAULT_TIMEOUT_MS || 12000);
  const API_RETRY_DELAY_MS = Number(APP_CONFIG.API_RETRY_DELAY_MS || 500);

  function apiUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${normalizedPath}`;
  }
  async function safeJson(response) {
    const text = await response.text();
    if (!text) return null;

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || /^\s*</.test(text)) {
      return { message: 'Unable to connect to server. Please try again later.' };
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      return { message: 'Unable to connect to server. Please try again later.' };
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
    return text.includes('a listener indicated an asynchronous response by returning true')
      || text.includes('listener indicated an asynchronous response')
      || text.includes('message channel closed before a response was received')
      || text.includes('async response')
      || text.includes('message channel closed');
  }

  function normalizeRequestError(error, url) {
    if (error?.name === 'AbortError') {
      return new Error('Server temporarily unavailable. Please try again later.');
    }

    if (isNetworkFailure(error)) {
      return new Error('Server temporarily unavailable. Please try again later.');
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

  const authFeedbackModal = document.getElementById('authFeedbackModal');
  const authFeedbackTitle = document.getElementById('authFeedbackTitle');
  const authFeedbackReason = document.getElementById('authFeedbackReason');
  const authFeedbackIcon = document.getElementById('authFeedbackIcon');
  const authFeedbackActionBtn = document.getElementById('authFeedbackActionBtn');
  let authFeedbackTimer = null;

  function toFriendlyAuthError(message, context = 'auth') {
    const raw = String(message || '').replace(/\s*\(https?:\/\/[^)]*\)\s*/gi, ' ').trim();
    const text = raw.toLowerCase();

    if (!raw) {
      if (context === 'register') return 'Unable to create account. Please try again later.';
      if (context === 'session') return 'Authentication failed. Please log in again.';
      return 'Unable to sign in right now. Please try again.';
    }

    if (text.includes('invalid email or password') || text.includes('wrong password')) {
      return 'Invalid email or password.';
    }

    if (text.includes('email already exists') || text.includes('duplicate key') || text.includes('e11000')) {
      return 'Email already exists.';
    }

    if (text.includes('valid email') || text.includes('required') || text.includes('validation')) {
      return 'Please check your details and try again.';
    }

    if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('network') || text.includes('unable to connect') || text.includes('failed after retries')) {
      return 'Server temporarily unavailable. Please try again later.';
    }

    if (text.includes('timed out') || text.includes('timeout')) {
      return 'The request timed out. Please try again.';
    }

    if (text.includes('authentication token has expired') || text.includes('invalid authentication token') || text.includes('authentication required') || text.includes('user no longer exists')) {
      return 'Your session has expired. Please log in again.';
    }

    if (text.includes('blocked')) {
      return 'This account is blocked. Please contact support.';
    }

    if (text.includes('mongo') || text.includes('server') || text.includes('internal')) {
      return context === 'register'
        ? 'Unable to create account. Please try again later.'
        : 'Server temporarily unavailable. Please try again later.';
    }

    return raw;
  }

  function closeAuthFeedbackModal() {
    if (!authFeedbackModal) return;
    authFeedbackModal.classList.remove('is-open', 'is-success');
    authFeedbackModal.setAttribute('aria-hidden', 'true');
    if (authFeedbackTimer) {
      window.clearTimeout(authFeedbackTimer);
      authFeedbackTimer = null;
    }
  }

  function showAuthFeedbackModal({
    status = 'error',
    title,
    reason,
    actionLabel = 'Try Again',
    autoCloseMs = 0
  }) {
    if (!authFeedbackModal || !authFeedbackTitle || !authFeedbackReason || !authFeedbackActionBtn || !authFeedbackIcon) {
      showGlobalNotification(reason || title || 'Authentication error', status !== 'success');
      return;
    }

    if (authFeedbackTimer) {
      window.clearTimeout(authFeedbackTimer);
      authFeedbackTimer = null;
    }

    authFeedbackModal.classList.add('is-open');
    authFeedbackModal.classList.toggle('is-success', status === 'success');
    authFeedbackModal.setAttribute('aria-hidden', 'false');

    authFeedbackIcon.textContent = status === 'success' ? '✅' : '⚠';
    authFeedbackTitle.textContent = title || (status === 'success' ? 'Success' : 'Authentication Failed');
    authFeedbackReason.textContent = reason || '';
    authFeedbackActionBtn.textContent = actionLabel;

    if (autoCloseMs > 0) {
      authFeedbackTimer = window.setTimeout(() => {
        closeAuthFeedbackModal();
      }, autoCloseMs);
    }
  }

  function showErrorModal(message, options = {}) {
    const context = options.context || 'auth';
    const title = options.title || (context === 'register' ? 'Registration Failed' : context === 'session' ? 'Authentication Required' : 'Login Failed');
    const reason = `Reason: ${toFriendlyAuthError(message, context)}`;

    showAuthFeedbackModal({
      status: 'error',
      title,
      reason,
      actionLabel: options.actionLabel || 'Try Again'
    });
  }

  function showSuccessModal(message, options = {}) {
    showAuthFeedbackModal({
      status: 'success',
      title: options.title || 'Success',
      reason: message,
      actionLabel: options.actionLabel || 'Continue',
      autoCloseMs: Number(options.autoCloseMs || 0)
    });
  }

  authFeedbackActionBtn?.addEventListener('click', closeAuthFeedbackModal);
  authFeedbackModal?.addEventListener('click', (event) => {
    if (event.target === authFeedbackModal) closeAuthFeedbackModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && authFeedbackModal?.classList.contains('is-open')) {
      closeAuthFeedbackModal();
    }
  });

  // --- Simple frontend auth helpers (store JWT in localStorage) ---
  const AUTH_TOKEN_KEY = 'auth_token';
  const AUTH_USER_KEY = 'auth_user';
  const ADMIN_TOKEN_KEY = 'admin_token';
  const ADMIN_USER_KEY = 'admin_profile';

  function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setToken(token) {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
    if (!token) setUser(null);
    renderAuthButtons();
    syncRealtimeSocket();
  }

  function setUser(user) {
    if (user) sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(AUTH_USER_KEY);
    renderAuthButtons();
    syncRealtimeSocket();
  }

  function getUser() {
    try {
      const raw = sessionStorage.getItem(AUTH_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getAdminToken() {
    return localStorage.getItem(ADMIN_TOKEN_KEY) || sessionStorage.getItem(ADMIN_TOKEN_KEY);
  }

  function getAdminUser() {
    try {
      const raw = localStorage.getItem(ADMIN_USER_KEY) || sessionStorage.getItem(ADMIN_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function getSessionUser() {
    return getUser();
  }

  function getSessionRole() {
    return String(getSessionUser()?.role || '').toLowerCase();
  }

  function isAdminSession() {
    return getSessionRole() === 'admin';
  }

  function isAuthenticatedSession() {
    return Boolean(getToken() || getSessionUser());
  }

  function getLogoutEndpoint() {
    return isAdminSession() ? '/api/admin/auth/logout' : '/api/auth/logout';
  }

  async function performLogout() {
    try {
      if (isAuthenticatedSession()) {
        await performRequest(apiUrl(getLogoutEndpoint()), { method: 'POST' }, { suppressAuthModal: true, retries: 0 });
      }
    } catch (_) {
      // ignore logout failures and still clear the local session state
    } finally {
      setToken(null);
      setUser(null);
    }
  }

  let realtimeSocket = null;
  let realtimeSocketUserId = '';

  function disconnectRealtimeSocket() {
    if (!realtimeSocket) return;
    realtimeSocket.removeAllListeners?.();
    realtimeSocket.disconnect();
    realtimeSocket = null;
    realtimeSocketUserId = '';
  }

  async function refreshBookingsModalIfOpen() {
    const modal = document.getElementById('bookingsModal');
    if (!modal || modal.style.display !== 'flex' || !getToken()) return;

    try {
      const res = await authFetch(apiUrl('/api/bookings'), {}, { retries: 1 });
      const body = await safeJson(res);
      if (!res.ok || !body) return;
      showBookingsModal(body.bookings || []);
    } catch (error) {
      console.warn('Unable to refresh live bookings modal', error);
    }
  }

  function handleRealtimeCustomerUpdate(payload = {}) {
    const notification = payload.notification || payload;
    const eventName = payload.eventName || 'notification:new';
    const message = notification?.message || payload.message || 'Your booking has been updated.';
    showGlobalNotification(message, false);

    if (['booking:created', 'booking:status-updated', 'booking:driver-assigned', 'booking:cancelled', 'invoice:generated', 'invoice:updated', 'payment:received', 'payment:updated', 'payment:refunded', 'booking:updated'].includes(eventName)) {
      void refreshBookingsModalIfOpen();
    }
  }

  function syncRealtimeSocket() {
    const token = getToken();
    const user = getUser();

    if (!window.io || !token || !user?.id) {
      disconnectRealtimeSocket();
      return;
    }

    if (realtimeSocket && realtimeSocketUserId === String(user.id)) {
      return;
    }

    disconnectRealtimeSocket();
    realtimeSocketUserId = String(user.id);
    realtimeSocket = window.io(SOCKET_BASE_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: { token }
    });

    realtimeSocket.on('connect', () => {
      realtimeSocket.emit('join:user', user.id);
    });

    realtimeSocket.on('disconnect', () => undefined);
    realtimeSocket.on('connect_error', () => undefined);

    realtimeSocket.on('notification:new', (payload) => handleRealtimeCustomerUpdate(payload));
  }

  async function authFetch(url, opts = {}, requestOptions = {}) {
    opts = { ...opts };
    opts.headers = opts.headers ? { ...opts.headers } : {};
    const token = getToken();
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (!opts.headers.Accept) opts.headers.Accept = 'application/json';
    // include credentials in case backend relies on cookies
    opts.credentials = opts.credentials || 'include';
    const response = await performRequest(url, opts, requestOptions);

    if ((response.status === 401 || response.status === 403) && !requestOptions.suppressAuthModal) {
      let serverMessage = 'Authentication required';
      try {
        const body = await safeJson(response.clone());
        serverMessage = body?.message || serverMessage;
      } catch (_) {
        // ignore clone parsing errors
      }

      showErrorModal(serverMessage, { title: 'Authentication Required', context: 'session' });
      setToken(null);
      setUser(null);
    }

    return response;
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

  let __lastBookings = [];
  let __bookingViewMode = 'list';
  let __activeBooking = null;

  const bookingMoneyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  });

  const bookingTimeline = ['Pending', 'Approved', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Invoice Generated', 'Paid'];

  function formatBookingMoney(value) {
    const amount = Number(value || 0);
    return bookingMoneyFormatter.format(Number.isFinite(amount) ? amount : 0);
  }

  function formatBookingDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatBookingDateTime(dateValue, timeValue) {
    const datePart = formatBookingDate(dateValue);
    const timePart = String(timeValue || '').trim();
    return timePart ? `${datePart}, ${timePart}` : datePart;
  }

  function formatBookingDistance(value) {
    const distance = Number(value || 0);
    if (!Number.isFinite(distance) || distance <= 0) return '—';
    const rounded = distance >= 100 ? Math.round(distance) : Number(distance.toFixed(1));
    return `${rounded} KM`;
  }

  function getBookingStatusClass(status = '') {
    const normalized = String(status).toLowerCase();
    if (normalized.includes('paid')) return 'is-success';
    if (normalized.includes('reject') || normalized.includes('cancel')) return 'is-danger';
    if (normalized.includes('pending')) return 'is-warning';
    if (normalized.includes('approved') || normalized.includes('driver assigned') || normalized.includes('ride started') || normalized.includes('invoice generated')) return 'is-info';
    return 'is-neutral';
  }

  function getBookingTimelineIndex(status = '') {
    const normalized = String(status).toLowerCase();
    if (normalized.includes('reject') || normalized.includes('cancel')) return -1;
    const exact = bookingTimeline.findIndex((step) => String(step).toLowerCase() === normalized);
    if (exact >= 0) return exact;
    if (normalized.includes('paid')) return bookingTimeline.length - 1;
    if (normalized.includes('invoice')) return 5;
    if (normalized.includes('ride completed')) return 4;
    if (normalized.includes('ride started')) return 3;
    if (normalized.includes('driver assigned')) return 2;
    if (normalized.includes('approved')) return 1;
    return 0;
  }

  function getBookingReference(booking = {}) {
    return booking.bookingId || booking.invoiceId || booking._id || 'Booking';
  }

  function getBookingVehicleName(booking = {}) {
    return booking.selectedCar || booking.vehicle?.carName || booking.vehicleName || booking.vehicle || '—';
  }

  function getBookingTripType(booking = {}) {
    return booking.tripType || booking.selectedPackage || '—';
  }

  function getBookingDriver(booking = {}) {
    const driver = booking.assignedDriver;
    if (!driver) return null;
    return {
      name: driver.driverName || driver.name || 'Driver assigned',
      phone: driver.phone || '',
      vehicle: driver.vehicleAssigned || driver.vehicle || ''
    };
  }

  function getBookingFareBreakdown(booking = {}) {
    const finalBill = booking.finalBill || {};
    return [
      ['Base fare', booking.baseFare ?? finalBill.baseFare],
      ['Distance fare', booking.distanceFare ?? finalBill.distanceFare],
      ['Toll charges', booking.tollCharges ?? finalBill.tollCharges],
      ['Waiting charges', booking.waitingCharges ?? finalBill.waitingCharges],
      ['Night charges', booking.nightCharges ?? finalBill.nightCharges],
      ['Driver allowance', booking.driverAllowance ?? finalBill.driverAllowance],
      ['Extra charges', booking.extraCharges ?? finalBill.extraCharges],
      ['GST', booking.gstAmount ?? finalBill.gstAmount],
      ['Estimated fare', booking.estimatedFare],
      ['Final bill', finalBill.totalAmount ?? booking.totalFare]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  }

  function renderBookingTimeline(status = '') {
    const currentIndex = getBookingTimelineIndex(status);
    return `
      <div class="booking-timeline" aria-label="Booking status timeline">
        ${bookingTimeline.map((step, index) => {
          const state = currentIndex < 0 ? 'is-done is-error' : index < currentIndex ? 'is-done' : index === currentIndex ? 'is-current' : 'is-upcoming';
          return `<span class="booking-timeline__step ${state}"><span>${escapeHtml(step)}</span></span>`;
        }).join('')}
      </div>
    `;
  }

  function renderBookingListItem(booking, index) {
    const reference = getBookingReference(booking);
    const vehicleName = getBookingVehicleName(booking);
    const tripType = getBookingTripType(booking);
    const distance = formatBookingDistance(booking.distanceInKm || booking.distance || booking.finalBill?.distanceInKm);
    const fare = formatBookingMoney(booking.totalFare || booking.estimatedFare || booking.finalBill?.totalAmount || 0);
    const pickupDate = formatBookingDateTime(booking.pickupDate, booking.pickupTime);
    const status = String(booking.bookingStatus || 'Pending');
    const paymentStatus = String(booking.paymentStatus || 'Pending');
    const driver = getBookingDriver(booking);

    return `
      <li class="booking-list-item" data-booking-index="${index}">
        <div class="booking-list-item__hero">
          <div class="booking-list-item__icon" aria-hidden="true">
            <i class="fa-solid fa-car-side"></i>
          </div>
          <div class="booking-list-item__title-group">
            <div class="booking-list-item__eyebrow">Booking #${escapeHtml(reference)}</div>
            <h4>${escapeHtml(vehicleName)}</h4>
            <div class="booking-list-item__meta">
              <span>${escapeHtml(tripType)}</span>
              <span>${escapeHtml(distance)}</span>
              <span>${escapeHtml(pickupDate)}</span>
            </div>
          </div>
          <div class="booking-list-item__money">
            <strong>${escapeHtml(fare)}</strong>
            <span class="booking-badge ${getBookingStatusClass(status)}">${escapeHtml(status)}</span>
          </div>
        </div>

        <div class="booking-list-item__route">
          <div class="booking-route-point">
            <span class="booking-route-point__label">Pickup</span>
            <strong>${escapeHtml(booking.pickupLocation || '—')}</strong>
          </div>
          <div class="booking-route-point">
            <span class="booking-route-point__label">Destination</span>
            <strong>${escapeHtml(booking.dropLocation || '—')}</strong>
          </div>
        </div>

        <div class="booking-list-item__footer">
          <div class="booking-list-item__footer-group">
            <span class="booking-card__label">Payment</span>
            <span class="booking-badge booking-badge--payment ${getBookingStatusClass(paymentStatus)}">${escapeHtml(paymentStatus)}</span>
          </div>
          <div class="booking-list-item__footer-group">
            <span class="booking-card__label">Driver</span>
            <span class="booking-card__value">${escapeHtml(driver ? driver.name : 'Not assigned yet')}</span>
          </div>
          <div class="booking-list-item__actions">
            <button class="btn btn-ghost btn-sm" type="button" data-booking-view="${index}">View Details</button>
            ${booking.invoiceId || booking.invoice?.invoiceId || booking.invoiceGenerated ? `<button class="btn btn-primary btn-sm" type="button" data-booking-download="${index}">Download Invoice</button>` : ''}
          </div>
        </div>
      </li>
    `;
  }

  function renderBookingsList(bookings) {
    return `
      <div class="bookings-modal__section">
        <div class="bookings-modal__summary">
          <div>
            <p class="bookings-modal__eyebrow">Customer dashboard</p>
            <h3>My Bookings</h3>
          </div>
          <span class="booking-count">${bookings.length} booking${bookings.length === 1 ? '' : 's'}</span>
        </div>
        <p class="bookings-modal__lede">Review your trips, payment status, and invoices without internal system data.</p>
        ${bookings.length ? `<ul class="bookings-list">${bookings.map((booking, index) => renderBookingListItem(booking, index)).join('')}</ul>` : '<div class="booking-empty">No bookings found.</div>'}
      </div>
    `;
  }

  function renderBookingsModalNotice(title, message) {
    return `
      <div class="booking-empty booking-empty--notice">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  }

  function renderBookingDetail(booking) {
    const reference = getBookingReference(booking);
    const vehicleName = getBookingVehicleName(booking);
    const tripType = getBookingTripType(booking);
    const pickupDate = formatBookingDateTime(booking.pickupDate, booking.pickupTime);
    const distance = formatBookingDistance(booking.distanceInKm || booking.distance || booking.finalBill?.distanceInKm);
    const estimatedFare = formatBookingMoney(booking.estimatedFare || booking.totalFare || booking.finalBill?.totalAmount || 0);
    const finalFare = formatBookingMoney(booking.finalBill?.totalAmount || booking.totalFare || booking.estimatedFare || 0);
    const status = String(booking.bookingStatus || 'Pending');
    const paymentStatus = String(booking.paymentStatus || 'Pending');
    const driver = getBookingDriver(booking);
    const fareBreakdown = getBookingFareBreakdown(booking);
    const invoiceId = booking.invoiceId || booking.invoice?.invoiceId || 'Pending';
    const routeHint = booking.pickupAddress || booking.destinationAddress || booking.specialRequirements || '';

    return `
      <div class="booking-detail">
        <div class="booking-detail__header">
          <button class="btn btn-ghost btn-sm" type="button" data-booking-back>Back to bookings</button>
          <div class="booking-detail__title">
            <p class="bookings-modal__eyebrow">Booking #${escapeHtml(reference)}</p>
            <h3>${escapeHtml(vehicleName)}</h3>
            <div class="booking-detail__meta">
              <span>${escapeHtml(tripType)}</span>
              <span>${escapeHtml(distance)}</span>
              <span>${escapeHtml(pickupDate)}</span>
            </div>
          </div>
          <div class="booking-detail__status">
            <span class="booking-badge ${getBookingStatusClass(status)}">${escapeHtml(status)}</span>
            <span class="booking-badge booking-badge--payment ${getBookingStatusClass(paymentStatus)}">${escapeHtml(paymentStatus)}</span>
          </div>
        </div>

        <div class="booking-detail__grid">
          <section class="booking-panel">
            <h4>Booking Information</h4>
            <div class="booking-info-list">
              <div><span>Pickup</span><strong>${escapeHtml(booking.pickupLocation || '—')}</strong></div>
              <div><span>Destination</span><strong>${escapeHtml(booking.dropLocation || '—')}</strong></div>
              <div><span>Booking date</span><strong>${escapeHtml(pickupDate)}</strong></div>
              <div><span>Vehicle</span><strong>${escapeHtml(vehicleName)}</strong></div>
              <div><span>Trip type</span><strong>${escapeHtml(tripType)}</strong></div>
              <div><span>Distance</span><strong>${escapeHtml(distance)}</strong></div>
            </div>
            ${routeHint ? `<p class="booking-panel__note">${escapeHtml(routeHint)}</p>` : ''}
          </section>

          <section class="booking-panel">
            <h4>Driver Details</h4>
            ${driver ? `
              <div class="booking-driver-card">
                <div class="booking-driver-card__icon"><i class="fa-solid fa-user-tie"></i></div>
                <div>
                  <strong>${escapeHtml(driver.name)}</strong>
                  <span>${escapeHtml(driver.phone || 'Contact shared after assignment')}</span>
                  ${driver.vehicle ? `<small>${escapeHtml(driver.vehicle)}</small>` : ''}
                </div>
              </div>
            ` : '<div class="booking-empty booking-empty--compact">Driver will appear here once assigned.</div>'}
          </section>

          <section class="booking-panel booking-panel--wide">
            <h4>Fare Breakdown</h4>
            <div class="booking-fare-grid">
              ${fareBreakdown.map(([label, value]) => `<div class="booking-fare-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatBookingMoney(value))}</strong></div>`).join('')}
            </div>
          </section>

          <section class="booking-panel">
            <h4>Payment</h4>
            <div class="booking-info-list">
              <div><span>Payment status</span><strong>${escapeHtml(paymentStatus)}</strong></div>
              <div><span>Invoice</span><strong>${escapeHtml(invoiceId)}</strong></div>
              <div><span>Estimated fare</span><strong>${escapeHtml(estimatedFare)}</strong></div>
              <div><span>Final amount</span><strong>${escapeHtml(finalFare)}</strong></div>
            </div>
          </section>
        </div>

        <div class="booking-detail__timeline">
          <h4>Status Timeline</h4>
          ${renderBookingTimeline(status)}
        </div>

        <div class="booking-detail__actions">
          ${booking.invoiceId || booking.invoice?.invoiceId || booking.invoiceGenerated ? `<button class="btn btn-primary" type="button" data-booking-download-detail>Download Invoice</button>` : ''}
          <button class="btn btn-ghost" type="button" data-booking-back>View all bookings</button>
        </div>
      </div>
    `;
  }

  function bindBookingsModalActions() {
    const list = document.getElementById('bookingsList');
    if (!list) return;

    list.querySelectorAll('[data-booking-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-booking-view'));
        const booking = __lastBookings[index];
        if (booking) showBookingDetail(booking);
      });
    });

    list.querySelectorAll('[data-booking-download]').forEach((button) => {
      button.addEventListener('click', async () => {
        const index = Number(button.getAttribute('data-booking-download'));
        const booking = __lastBookings[index];
        if (booking) await downloadBookingInvoice(booking);
      });
    });

    list.querySelectorAll('[data-booking-back]').forEach((button) => {
      button.addEventListener('click', () => showBookingsModal(__lastBookings));
    });

    const detailDownloadBtn = list.querySelector('[data-booking-download-detail]');
    if (detailDownloadBtn && __bookingViewMode === 'detail' && __activeBooking) {
      detailDownloadBtn.addEventListener('click', async () => {
        await downloadBookingInvoice(__activeBooking);
      });
    }
  }

  async function downloadBookingInvoice(booking) {
    try {
      const response = await authFetch(apiUrl(`/api/bookings/${booking._id}/invoice/download`), { method: 'GET' });
      if (!response.ok) throw new Error('Invoice download failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${booking.invoiceId || booking.invoice?.invoiceId || booking.bookingId || 'invoice'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      showGlobalNotification(error.message || 'Invoice download failed');
    }
  }

  function showBookingsModal(bookings) {
    try {
      __lastBookings = Array.isArray(bookings) ? bookings : [];
      __bookingViewMode = 'list';
      __activeBooking = null;
      const modal = document.getElementById('bookingsModal');
      const list = document.getElementById('bookingsList');
      const closeBtn = document.getElementById('bookingsCloseBtn');
      if (!modal || !list) return;
      list.innerHTML = renderBookingsList(__lastBookings);
      bindBookingsModalActions();
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      const title = modal.querySelector('h3');
      if (title) title.textContent = 'My Bookings';
      if (closeBtn && !closeBtn._bookingsHandler) {
        closeBtn.addEventListener('click', () => {
          modal.style.display = 'none';
          modal.setAttribute('aria-hidden', 'true');
        });
        closeBtn._bookingsHandler = true;
      }
    } catch (e) {
      showGlobalNotification('Unable to display your bookings right now.');
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function showBookingDetail(b) {
    try {
      __activeBooking = b || null;
      const modal = document.getElementById('bookingsModal');
      const list = document.getElementById('bookingsList');
      if (!modal || !list) return;
      __bookingViewMode = 'detail';
      list.innerHTML = renderBookingDetail(b);
      bindBookingsModalActions();
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      const title = modal.querySelector('h3');
      if (title) title.textContent = `Booking #${getBookingReference(b)}`;
    } catch (e) {
      showGlobalNotification('Unable to open booking details right now.');
    }
  }

  function renderAuthButtons() {
    const loginBtn = document.getElementById('loginOpenBtn');
    const registerBtn = document.getElementById('registerOpenBtn');
    const mobileLoginBtn = document.getElementById('mobileLoginOpenBtn');
    const mobileRegisterBtn = document.getElementById('mobileRegisterOpenBtn');
    const navRight = document.querySelector('.nav-right');
    const desktopAdminPanelLink = document.querySelector('[data-admin-panel-link]');
    const mobileAdminPanelLink = document.querySelector('[data-mobile-admin-panel-link]');
    const mobileAccount = document.querySelector('[data-mobile-account]');
    const mobileAvatar = document.querySelector('[data-mobile-avatar]');
    const mobileName = document.querySelector('[data-mobile-name]');
    const mobileEmail = document.querySelector('[data-mobile-email]');
    const mobileMyBookingsBtn = document.getElementById('mobileMyBookingsBtn');
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');
    if (!navRight) return;

    const existingLogout = document.getElementById('logoutBtn');
    const existingMyBookings = document.getElementById('myBookingsBtn');
    const existingAdminPanel = document.getElementById('adminPanelBtn');

    const user = getUser() || getAdminUser();
    const token = getToken() || getAdminToken();
    const isLoggedIn = Boolean(token || user);
    const isAdmin = user?.role === 'admin';

    if (isLoggedIn) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (registerBtn) registerBtn.style.display = 'none';
      if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
      if (mobileRegisterBtn) mobileRegisterBtn.style.display = 'none';
      if (mobileAccount) mobileAccount.classList.remove('is-hidden');

      if (desktopAdminPanelLink) desktopAdminPanelLink.hidden = !isAdmin;
      if (mobileAdminPanelLink) mobileAdminPanelLink.hidden = !isAdmin;

      if (isAdmin) {
        if (existingMyBookings) existingMyBookings.remove();
        if (mobileMyBookingsBtn) {
          mobileMyBookingsBtn.style.display = 'none';
          mobileMyBookingsBtn.onclick = null;
        }

        if (!existingAdminPanel) {
          const adminLink = document.createElement('a');
          adminLink.id = 'adminPanelBtn';
          adminLink.className = 'btn btn-ghost desktop-only-action';
          adminLink.href = 'admin/index.html';
          adminLink.textContent = 'Admin Panel';
          navRight.insertBefore(adminLink, menuBtn);
        }
      } else {
        if (existingAdminPanel) existingAdminPanel.remove();
        if (!existingMyBookings) {
          const mb = document.createElement('button');
          mb.id = 'myBookingsBtn';
          mb.className = 'btn btn-ghost desktop-only-action';
          mb.type = 'button';
          mb.textContent = 'My Bookings';
          mb.addEventListener('click', async () => {
            const modal = document.getElementById('bookingsModal');
            const list = document.getElementById('bookingsList');
            if (modal && list) {
              __bookingViewMode = 'list';
              list.innerHTML = renderBookingsModalNotice('Loading bookings...', 'Please wait while we fetch your trips.');
              modal.style.display = 'flex';
              modal.setAttribute('aria-hidden', 'false');
            }
            try {
              const res = await authFetch(apiUrl('/api/bookings'), {}, { retries: 1 });
              const body = await safeJson(res);
              if (!res.ok) throw new Error(body?.message || 'Booking failed to load');
              showBookingsModal(body.bookings || []);
            } catch (e) {
              if (modal && list) {
                list.innerHTML = renderBookingsModalNotice('Booking failed to load', 'Please try again in a moment.');
                modal.style.display = 'flex';
                modal.setAttribute('aria-hidden', 'false');
              }
              showGlobalNotification('Booking failed to load');
            }
          });
          navRight.insertBefore(mb, menuBtn);
        }

        if (mobileMyBookingsBtn) {
          mobileMyBookingsBtn.style.display = '';
          mobileMyBookingsBtn.onclick = async () => {
            closeMenu();
            const modal = document.getElementById('bookingsModal');
            const list = document.getElementById('bookingsList');
            if (modal && list) {
              __bookingViewMode = 'list';
              list.innerHTML = renderBookingsModalNotice('Loading bookings...', 'Please wait while we fetch your trips.');
              modal.style.display = 'flex';
              modal.setAttribute('aria-hidden', 'false');
            }
            try {
              const res = await authFetch(apiUrl('/api/bookings'), {}, { retries: 1 });
              const body = await safeJson(res);
              if (!res.ok) throw new Error(body?.message || 'Booking failed to load');
              showBookingsModal(body.bookings || []);
            } catch (e) {
              if (modal && list) {
                list.innerHTML = renderBookingsModalNotice('Booking failed to load', 'Please try again in a moment.');
                modal.style.display = 'flex';
                modal.setAttribute('aria-hidden', 'false');
              }
              showGlobalNotification('Booking failed to load');
            }
          };
        }
      }

      if (!existingLogout) {
        const lb = document.createElement('button');
        lb.id = 'logoutBtn';
        lb.className = 'btn btn-ghost desktop-only-action';
        lb.type = 'button';
        lb.textContent = 'Logout';
        lb.addEventListener('click', () => {
          void performLogout();
          showGlobalNotification('Logged out', false);
        });
        navRight.insertBefore(lb, menuBtn);
      }

      if (mobileLogoutBtn) {
        mobileLogoutBtn.onclick = () => {
          closeMenu();
          void performLogout();
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
        userLabel.textContent = user.name || user.email || 'Profile';
        navRight.insertBefore(userLabel, menuBtn);
      } else if (userLabel && user) {
        userLabel.textContent = user.name || user.email || 'Profile';
      } else if (userLabel && !user) {
        userLabel.remove();
      }

      if (mobileAvatar) mobileAvatar.textContent = (user?.name || user?.email || 'Me').slice(0, 2).toUpperCase();
      if (mobileName) mobileName.textContent = user?.name || user?.email || 'My Account';
      if (mobileEmail) mobileEmail.textContent = user?.email || (isAdmin ? 'Admin account' : 'Manage bookings and profile');
    } else {
      if (loginBtn) loginBtn.style.display = '';
      if (registerBtn) registerBtn.style.display = '';
      if (mobileLoginBtn) mobileLoginBtn.style.display = '';
      if (mobileRegisterBtn) mobileRegisterBtn.style.display = '';
      if (existingMyBookings) existingMyBookings.remove();
      if (existingAdminPanel) existingAdminPanel.remove();
      if (existingLogout) existingLogout.remove();
      const userLabel = document.getElementById('userLabel');
      if (userLabel) userLabel.remove();
      if (mobileAccount) mobileAccount.classList.add('is-hidden');
      if (mobileAvatar) mobileAvatar.textContent = 'Me';
      if (mobileName) mobileName.textContent = 'Guest';
      if (mobileEmail) mobileEmail.textContent = 'Sign in to manage your trips';
      if (mobileMyBookingsBtn) mobileMyBookingsBtn.onclick = null;
      if (mobileLogoutBtn) mobileLogoutBtn.onclick = null;
      if (desktopAdminPanelLink) desktopAdminPanelLink.hidden = true;
      if (mobileAdminPanelLink) mobileAdminPanelLink.hidden = true;
    }
  }

  // Initialize auth UI state
  renderAuthButtons();
  syncRealtimeSocket();

  // Try to auto-login by fetching profile if we do not already have a cached user.
  async function fetchProfileOnLoad() {
    const cached = getUser();
    if (cached) return; // already have user info
    try {
      const res = await authFetch(apiUrl('/api/auth/profile'), {}, { suppressAuthModal: true });
      const body = await safeJson(res);
      if (!res.ok || !body || !body.user) {
        // token likely invalid or expired
        showErrorModal(body?.message || 'Authentication required', { title: 'Authentication Required', context: 'session' });
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
    let autoplayTimer = null;
    let isHovering = false;
    let isFocused = false;

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

      if (prevBtn) prevBtn.disabled = cards.length < 2;
      if (nextBtn) nextBtn.disabled = cards.length < 2;

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
      if (prefersReducedMotion || cards.length < 2) return;
      if (autoplayTimer) return;
      autoplayTimer = window.setInterval(() => {
        if (document.hidden || isHovering || isFocused) return;
        advance();
      }, 3200);
    };

    const stopAutoplay = () => {
      if (autoplayTimer) {
        window.clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
    };

    prevBtn?.addEventListener('click', () => {
      stopAutoplay();
      update(index - 1, { loop: true });
      startAutoplay();
    });
    nextBtn?.addEventListener('click', () => {
      stopAutoplay();
      update(index + 1, { loop: true });
      startAutoplay();
    });

    carousel.addEventListener('mouseenter', () => {
      isHovering = true;
      stopAutoplay();
    });

    carousel.addEventListener('mouseleave', () => {
      isHovering = false;
      startAutoplay();
    });

    carousel.addEventListener('focusin', () => {
      isFocused = true;
      stopAutoplay();
    });

    carousel.addEventListener('focusout', () => {
      isFocused = false;
      startAutoplay();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAutoplay();
      } else {
        startAutoplay();
      }
    });

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
  const forgotForm = document.getElementById('forgotForm');
  const resetForm = document.getElementById('resetForm');
  const showRegister = document.getElementById('showRegister');
  const showLogin = document.getElementById('showLogin');
  const showForgot = document.getElementById('showForgot');
  const forgotBackToLogin = document.getElementById('forgotBackToLogin');
  const resetBackToLogin = document.getElementById('resetBackToLogin');
  const authTitle = document.getElementById('authTitle');
  const resetTokenParam = new URLSearchParams(window.location.search).get('resetToken');
  let pendingResetToken = resetTokenParam || '';

  function setResetToken(token) {
    pendingResetToken = token || '';
    const tokenInput = resetForm?.querySelector('[name="token"]');
    if (tokenInput) tokenInput.value = pendingResetToken;
  }

  function showOnlyForm(activeForm) {
    [loginForm, registerForm, forgotForm, resetForm].forEach((form) => {
      if (!form) return;
      form.classList.toggle('is-hidden', form !== activeForm);
    });
  }

  function openAuth(mode = 'login') {
    if (!authModal) return;
    authModal.classList.add('is-open');
    authModal.setAttribute('aria-hidden', 'false');

    if (mode === 'login') {
      showOnlyForm(loginForm);
      authTitle.textContent = 'Login';
    } else if (mode === 'register') {
      showOnlyForm(registerForm);
      authTitle.textContent = 'Register';
    } else if (mode === 'forgot') {
      showOnlyForm(forgotForm);
      authTitle.textContent = 'Reset Password';
    } else if (mode === 'reset') {
      showOnlyForm(resetForm);
      authTitle.textContent = 'Reset Password';
      setResetToken(pendingResetToken);
    }
  }

  function closeAuth() {
    if (!authModal) return;
    authModal.classList.remove('is-open');
    authModal.setAttribute('aria-hidden', 'true');
  }

  function syncResetTokenFromLocation() {
    const token = new URLSearchParams(window.location.search).get('resetToken');
    if (token) {
      setResetToken(token);
      openAuth('reset');
    }
  }

  syncResetTokenFromLocation();
  window.addEventListener('popstate', syncResetTokenFromLocation);


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
  showForgot?.addEventListener('click', () => openAuth('forgot'));
  forgotBackToLogin?.addEventListener('click', () => openAuth('login'));
  resetBackToLogin?.addEventListener('click', () => openAuth('login'));


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
      showSuccessModal('Redirecting to dashboard...', {
        title: 'Login Successful',
        actionLabel: 'Continue',
        autoCloseMs: 1800
      });
    } catch (err) {
      showErrorModal((err && err.message) || 'Login failed', {
        title: 'Login Failed',
        context: 'login',
        actionLabel: 'Try Again'
      });
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
      showSuccessModal('Your account has been created successfully.', {
        title: 'Registration Successful',
        actionLabel: 'Continue',
        autoCloseMs: 2100
      });
    } catch (err) {
      showErrorModal((err && err.message) || 'Registration failed', {
        title: 'Registration Failed',
        context: 'register',
        actionLabel: 'Try Again'
      });
      console.error(err);
    } finally {
      setFormSubmitting(form, false);
    }
  });

  forgotForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.querySelector('[name="email"]').value.trim();
    setFormSubmitting(form, true, 'Sending reset link...');
    try {
      const res = await performRequest(apiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || body.success !== true) throw new Error((body && body.message) || 'Password reset request failed');

      if (body.resetUrl) {
        const token = new URL(body.resetUrl).searchParams.get('resetToken');
        setResetToken(token);
        openAuth('reset');
        showSuccessModal('Reset link prepared. Enter a new password to complete the reset.', {
          title: 'Reset Link Generated',
          actionLabel: 'Continue',
          autoCloseMs: 1400
        });
      } else {
        showSuccessModal(body.message || 'If the account exists, password reset instructions have been sent.', {
          title: 'Reset Link Sent',
          actionLabel: 'Continue',
          autoCloseMs: 2200
        });
        openAuth('login');
      }
    } catch (err) {
      showErrorModal((err && err.message) || 'Password reset request failed', {
        title: 'Reset Failed',
        context: 'session',
        actionLabel: 'Try Again'
      });
      console.error(err);
    } finally {
      setFormSubmitting(form, false);
    }
  });

  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const token = String(form.querySelector('[name="token"]').value || '').trim();
    const password = form.querySelector('[name="password"]').value;
    const confirmPassword = form.querySelector('[name="confirmPassword"]').value;

    if (password !== confirmPassword) {
      showErrorModal('Passwords do not match', { title: 'Reset Failed', context: 'session', actionLabel: 'Try Again' });
      return;
    }

    setFormSubmitting(form, true, 'Updating password...');
    try {
      const res = await performRequest(apiUrl('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const body = await safeJson(res);
      if (!res.ok || !body || body.success !== true) throw new Error((body && body.message) || 'Password reset failed');
      setResetToken('');
      window.history.replaceState({}, document.title, window.location.pathname);
      showSuccessModal(body.message || 'Password updated successfully', {
        title: 'Password Updated',
        actionLabel: 'Continue',
        autoCloseMs: 2000
      });
      openAuth('login');
    } catch (err) {
      showErrorModal((err && err.message) || 'Password reset failed', {
        title: 'Reset Failed',
        context: 'session',
        actionLabel: 'Try Again'
      });
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
    const useCurrentLocationBtn = form.querySelector('[data-use-current-location]');
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

    const shouldLogBookingDiagnostics = () => window.__BOOKING_DEBUG__ || /localhost|127\.0\.0\.1/i.test(window.location.hostname);

    const logBookingDiagnostics = (...args) => {
      if (shouldLogBookingDiagnostics()) {
        console.debug('[booking]', ...args);
      }
    };

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
      if (Array.isArray(value) && value.length >= 2) {
        const longitude = Number(value[0]);
        const latitude = Number(value[1]);
        if (Number.isFinite(longitude) && Number.isFinite(latitude)) return [longitude, latitude];
      }

      const parts = String(value).split(',').map((item) => Number(item.trim()));
      if (parts.length >= 2 && parts.every(Number.isFinite)) return [parts[0], parts[1]];
      return null;
    };

    const serializeCoords = (coordinates) => {
      const parsed = parseCoords(coordinates);
      return parsed ? parsed.join(',') : '';
    };

    const setPickupCoordinatesValue = (coordinates) => {
      if (pickupCoordinates) pickupCoordinates.value = serializeCoords(coordinates);
    };

    const setDropCoordinatesValue = (coordinates) => {
      if (dropCoordinates) dropCoordinates.value = serializeCoords(coordinates);
    };

    const requestCurrentPosition = () => new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported in this browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      });
    });

    const describeGeolocationError = (error) => {
      const code = Number(error?.code);
      if (code === 1) return 'Location permission denied. You can enter the pickup manually.';
      if (code === 2) return 'Location unavailable right now. You can enter the pickup manually.';
      if (code === 3) return 'Location lookup timed out. You can enter the pickup manually.';
      return error?.message || 'Unable to use current location. You can still enter the pickup manually.';
    };

    const extractReverseGeocodeLabel = (location) => {
      if (!location) return '';
      const candidates = [
        location.label,
        location.address,
        location.displayName,
        location.name,
        location.formattedAddress,
        location.text,
        location.placeName
      ];
      return String(candidates.find((value) => String(value || '').trim()) || '').trim();
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
      if (coordField) coordField.value = '';
      if (!query || query.length < 3 || !datalist) return;

      try {
        const response = await performRequest(apiUrl(`/api/fare/geocode?query=${encodeURIComponent(query)}&limit=5`));
        const result = await safeJson(response);
        const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
        datalist.innerHTML = suggestions.map((item) => `<option value="${escapeHtml(item.label || query)}"></option>`).join('');

        const exactMatch = suggestions.find((item) => String(item.label || '').toLowerCase() === query.toLowerCase()) || suggestions[0];
        if (exactMatch?.coordinates && coordField) {
          coordField.value = serializeCoords(exactMatch.coordinates);
          logBookingDiagnostics('geocode selection', { query, coordinates: exactMatch.coordinates, label: exactMatch.label });
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

    const populatePickupFromCurrentLocation = async () => {
      if (!useCurrentLocationBtn || !pickupLoc) return;

      const originalText = useCurrentLocationBtn.textContent;
      useCurrentLocationBtn.disabled = true;
      useCurrentLocationBtn.textContent = 'Locating...';

      try {
        const position = await requestCurrentPosition();
        const { latitude, longitude } = position.coords || {};

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error('Invalid GPS coordinates received from the browser.');
        }

        setPickupCoordinatesValue([longitude, latitude]);
        logBookingDiagnostics('current location coordinates', { latitude, longitude, serialized: pickupCoordinates?.value || '' });

        let resolvedLabel = '';
        try {
          const response = await performRequest(apiUrl(`/api/fare/reverse-geocode?lng=${encodeURIComponent(longitude)}&lat=${encodeURIComponent(latitude)}`));
          const result = await safeJson(response);
          resolvedLabel = extractReverseGeocodeLabel(result?.location);
          logBookingDiagnostics('reverse geocode result', { longitude, latitude, resolvedLabel, result });
        } catch (reverseError) {
          console.warn('Reverse geocoding failed, keeping GPS coordinates only.', reverseError);
        }

        if (!resolvedLabel) {
          resolvedLabel = `Current Location (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`;
        }

        if (resolvedLabel) {
          pickupLoc.value = resolvedLabel;
        }

        validateBookingField(pickupLoc, true);
        updateSubmitState();
        void calculateQuote();
      } catch (error) {
        console.warn('Current location lookup failed', error);
        showGlobalNotification(describeGeolocationError(error));
      } finally {
        useCurrentLocationBtn.disabled = false;
        useCurrentLocationBtn.textContent = originalText;
      }
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

        logBookingDiagnostics('fare payload', payload);

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
            pickupAddress: pickupLoc.value.trim(),
          dropLocation: dropLoc.value.trim(),
            destinationAddress: dropLoc.value.trim(),
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
            destinationCoordinates: dropCoordinates.value,
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

      const scheduleAutocomplete = () => {
        window.clearTimeout(index === 0 ? pickupTimer : dropTimer);
        if (index === 0) pickupTimer = window.setTimeout(() => void refreshLocationSuggestions(input, datalist, coordField), 350);
        else dropTimer = window.setTimeout(() => void refreshLocationSuggestions(input, datalist, coordField), 350);
      };

      input.addEventListener('input', () => {
        if (coordField) coordField.value = '';
        scheduleAutocomplete();
      });
      input.addEventListener('change', async () => {
        await refreshLocationSuggestions(input, datalist, coordField);
        debounceQuote();
      });
      input.addEventListener('blur', async () => {
        await refreshLocationSuggestions(input, datalist, coordField);
        debounceQuote();
      });
    });

    useCurrentLocationBtn?.addEventListener('click', () => {
      void populatePickupFromCurrentLocation();
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

