(() => {
  const APP_CONFIG = window.APP_CONFIG || {};
  const FALLBACK_API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://webpage-96yf.onrender.com';
  const API_BASE_URL = String(APP_CONFIG.API_BASE_URL || window.API_BASE_URL || FALLBACK_API_BASE_URL).replace(/\/$/, '');
  const SOCKET_BASE_URL = String(APP_CONFIG.SOCKET_BASE_URL || window.SOCKET_BASE_URL || API_BASE_URL).replace(/\/$/, '');
  const DEFAULT_TIMEOUT_MS = Number(APP_CONFIG.DEFAULT_TIMEOUT_MS || 12000);
  const STORAGE_TOKEN = 'admin_token';
  const STORAGE_ADMIN = 'admin_profile';
  const FETCH_LOG_PREFIX = '[fetch:admin]';

  function redactLogValue(key, value) {
    const sensitiveKeys = ['password', 'confirmPassword', 'token', 'authorization', 'secret'];
    if (sensitiveKeys.includes(String(key || '').toLowerCase())) {
      return '[redacted]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => redactLogValue('', item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryKey, entryValue)]));
    }

    return value;
  }

  function describeRequestPayload(options = {}) {
    const body = options.body;
    if (body == null) return undefined;

    if (typeof body === 'string') {
      try {
        return redactLogValue('', JSON.parse(body));
      } catch (_) {
        return body.length > 800 ? `${body.slice(0, 800)}…` : body;
      }
    }

    if (body instanceof FormData || body instanceof URLSearchParams) {
      return redactLogValue('', Object.fromEntries(Array.from(body.entries())));
    }

    if (typeof body === 'object') {
      return redactLogValue('', body);
    }

    return String(body);
  }

  async function describeResponseBody(response) {
    if (!response) return undefined;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('json') && !contentType.includes('text') && !contentType.includes('application/problem+json')) {
      return '[non-text response omitted]';
    }

    try {
      const text = await response.clone().text();
      if (!text) return null;
      try {
        return redactLogValue('', JSON.parse(text));
      } catch (_) {
        return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
      }
    } catch (error) {
      return { error: error.message || 'Unable to read response body for logging' };
    }
  }

  function logFetchRequest(url, options = {}) {
    console.info(FETCH_LOG_PREFIX, {
      phase: 'request',
      endpoint: url,
      method: String(options.method || 'GET').toUpperCase(),
      payload: describeRequestPayload(options)
    });
  }

  async function logFetchResponse(url, options, response) {
    console.info(FETCH_LOG_PREFIX, {
      phase: 'response',
      endpoint: url,
      method: String(options.method || 'GET').toUpperCase(),
      status: response.status,
      ok: response.ok,
      body: await describeResponseBody(response)
    });
  }

  function logFetchError(url, options, error) {
    console.warn(FETCH_LOG_PREFIX, {
      phase: 'error',
      endpoint: url,
      method: String(options.method || 'GET').toUpperCase(),
      payload: describeRequestPayload(options),
      rootCause: error?.stack || error?.message || error
    });
  }

  const el = {
    loginView: document.getElementById('loginView'),
    appView: document.getElementById('appView'),
    loginForm: document.getElementById('adminLoginForm'),
    loginError: document.getElementById('loginError'),
    loginButton: document.getElementById('loginButton'),
    togglePassword: document.getElementById('togglePassword'),
    logoutButton: document.getElementById('logoutButton'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebarToggleMobile: document.getElementById('sidebarToggleMobile'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    appShell: document.querySelector('.app-shell'),
    sideNav: document.getElementById('sideNav'),
    sidebarNavRoot: document.querySelector('#appView .sidebar'),
    viewRoot: document.getElementById('viewRoot'),
    viewLabel: document.getElementById('viewLabel'),
    viewTitle: document.getElementById('viewTitle'),
    globalSearch: document.getElementById('globalSearch'),
    topbarSearchSlot: document.getElementById('topbarSearchSlot'),
    refreshButton: document.getElementById('refreshButton'),
    adminName: document.getElementById('adminName'),
    adminChip: document.getElementById('adminChip'),
    adminAvatar: document.getElementById('adminAvatar'),
    sidebarAvatar: document.getElementById('sidebarAvatar'),
    sidebarAdminName: document.getElementById('sidebarAdminName'),
    sidebarAdminEmail: document.getElementById('sidebarAdminEmail'),
    notificationCount: document.getElementById('notificationCount'),
    notificationList: document.getElementById('notificationList'),
    notificationDropdown: document.getElementById('notificationDropdown'),
    topbar: document.querySelector('.topbar'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalEyebrow: document.getElementById('modalEyebrow'),
    modalBody: document.getElementById('modalBody'),
    closeModal: document.getElementById('closeModal'),
    toastHost: document.getElementById('toastHost')
  };

  const state = {
    token: localStorage.getItem(STORAGE_TOKEN) || sessionStorage.getItem(STORAGE_TOKEN) || '',
    admin: readJSON(STORAGE_ADMIN),
    view: 'dashboard',
    search: '',
    bookingFilters: {
      search: '',
      status: '',
      paymentStatus: '',
      vehicle: '',
      fromDate: '',
      toDate: ''
    },
    bookingReloadTimer: null,
    dashboard: null,
    bookings: null,
    drivers: null,
    cars: null,
    packages: null,
    routes: null,
    customers: null,
    payments: null,
    invoices: null,
    messages: null,
    settings: null,
    notifications: null,
    notificationUnreadCount: 0,
    charts: {},
    socket: null,
    busy: false
  };

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJSON(key, value) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }

  function fmtMoney(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  }

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${fmtDate(value)} ${date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function getNotificationSummary(item) {
    const metadata = item?.metadata || {};
    const customerName = item?.customerName || metadata.customerName || metadata.name || 'Customer';
    const rideType = metadata.serviceLabel || metadata.serviceType || (metadata.tripType ? String(metadata.tripType).replace(/[-_]/g, ' ') : '') || 'Ride';
    const vehicle = metadata.vehicle || metadata.selectedCar || metadata.vehicleName || '';
    const bookingStatus = metadata.bookingStatus || metadata.status || metadata.paymentStatus || item.status || '';

    return {
      customerName,
      rideType,
      vehicle,
      bookingStatus
    };
  }

  function upsertRealtimeNotification(notification) {
    if (!notification?._id) return;
    const list = Array.isArray(state.notifications) ? [...state.notifications] : [];
    const existingIndex = list.findIndex((item) => item._id === notification._id);
    if (existingIndex >= 0) list.splice(existingIndex, 1, notification);
    else list.unshift(notification);
    state.notifications = list;
    state.notificationUnreadCount = list.filter((item) => !item.isRead && !item.readAt).length;
    renderShellNotifications();
  }

  function getInitials(value) {
    const text = String(value || 'SA').trim();
    if (!text) return 'SA';
    const parts = text.split(/\s+/).filter(Boolean).slice(0, 2);
    const initials = parts.map((part) => part[0]).join('');
    return (initials || text.slice(0, 2) || 'SA').toUpperCase();
  }

  function getAdminName() {
    return state.admin?.name || state.admin?.email || 'Site Admin';
  }

  function getAdminEmail() {
    return state.admin?.email || 'admin@example.com';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function isBrowserExtensionNoise(reason) {
    const text = String(reason?.message || reason?.stack || reason || '').toLowerCase();
    return text.includes('a listener indicated an asynchronous response by returning true')
      || text.includes('listener indicated an asynchronous response')
      || text.includes('message channel closed before a response was received')
      || text.includes('async response')
      || text.includes('message channel closed');
  }

  window.addEventListener('unhandledrejection', (event) => {
    if (isBrowserExtensionNoise(event?.reason)) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    if (isBrowserExtensionNoise(event?.message || event?.error?.message || '')) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
  });

  function toast(title, message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerHTML = `<strong class="toast-title">${escapeHtml(title)}</strong><div class="toast-message">${escapeHtml(message)}</div>`;
    el.toastHost.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function createImagePlaceholder() {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="Image unavailable">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#120d1b" />
            <stop offset="100%" stop-color="#24193a" />
          </linearGradient>
        </defs>
        <rect width="960" height="540" rx="40" fill="url(#bg)" />
        <rect x="56" y="56" width="848" height="428" rx="28" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="4" />
        <circle cx="250" cy="260" r="72" fill="rgba(212,175,55,0.18)" />
        <path d="M188 300c30-55 72-82 126-82 48 0 90 23 130 71l26 31h112c18 0 32 14 32 32v42c0 14-12 26-26 26h-34c-10 33-40 57-76 57s-66-24-76-57H348c-10 33-40 57-76 57s-66-24-76-57h-26c-14 0-26-12-26-26v-28c0-13 5-24 14-36z" fill="rgba(212,175,55,0.8)" />
        <text x="480" y="392" fill="#f6f1e7" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" text-anchor="middle">Image unavailable</text>
      </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  const DEFAULT_IMAGE_PLACEHOLDER = createImagePlaceholder();

  function normalizeImageUrl(value) {
    return String(value || '').trim();
  }

  function isRelativeUploadPath(value) {
    return /^\/?uploads\/[\w./-]+\.(jpe?g|png|webp)$/i.test(value);
  }

  function isLikelyImageUrl(value) {
    const url = normalizeImageUrl(value);
    if (!url) return true;

    if (/^data:image\/(jpe?g|png|webp);/i.test(url)) return true;
    if (isRelativeUploadPath(url)) return true;

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;

      const pathname = `${parsed.pathname}${parsed.search}`.toLowerCase();
      if (/\.(jpe?g|png|webp)(?:$|\?)/.test(pathname)) return true;

      const host = parsed.hostname.toLowerCase();
      return host === 'images.unsplash.com' || host === 'unsplash.com' || host.endsWith('.cloudinary.com') || host.includes('image');
    } catch (_) {
      return false;
    }
  }

  function getPreviewSrc(value) {
    const url = normalizeImageUrl(value);
    return url && isLikelyImageUrl(url) ? url : DEFAULT_IMAGE_PLACEHOLDER;
  }

  function updatePreviewImage(previewEl, value, statusEl, altText) {
    if (!previewEl) return;
    const url = normalizeImageUrl(value);
    previewEl.src = getPreviewSrc(url);
    previewEl.alt = altText || previewEl.alt || 'Preview image';
    previewEl.dataset.fallback = DEFAULT_IMAGE_PLACEHOLDER;
    if (!statusEl) return;
    if (!url) {
      statusEl.textContent = 'Paste a direct image URL to preview it here.';
      return;
    }
    statusEl.textContent = isLikelyImageUrl(url)
      ? 'Image URL looks valid.'
      : 'This URL is not a supported direct image link. Preview is showing the fallback image.';
  }

  function renderImageThumb(value, altText) {
    const previewSrc = getPreviewSrc(value);
    return `<img class="preview image-thumb" src="${escapeHtml(previewSrc)}" alt="${escapeHtml(altText || 'Image preview')}" data-fallback="${escapeHtml(DEFAULT_IMAGE_PLACEHOLDER)}" onerror="this.onerror=null;this.src=this.dataset.fallback;" />`;
  }

  function renderImageUrlField({ name, label, value, alt, previewId, statusId, helper }) {
    const imageValue = normalizeImageUrl(value);
    const previewSrc = getPreviewSrc(imageValue);
    const statusText = !imageValue
      ? 'Paste a direct image URL to preview it here.'
      : (isLikelyImageUrl(imageValue) ? 'Image URL looks valid.' : 'This URL is not a supported direct image link. Preview is showing the fallback image.');

    return `
      <label class="field full image-url-field">
        <span>${escapeHtml(label)}</span>
        <input
          class="image-url-input"
          type="url"
          name="${escapeHtml(name)}"
          value="${escapeHtml(imageValue)}"
          placeholder="https://images.unsplash.com/..."
          autocomplete="off"
          spellcheck="false"
          data-image-preview="${escapeHtml(previewId)}"
          data-image-status="${escapeHtml(statusId)}"
          data-image-alt="${escapeHtml(alt || label)}"
        />
        <div class="image-preview-card">
          <img
            id="${escapeHtml(previewId)}"
            class="image-preview"
            src="${escapeHtml(previewSrc)}"
            alt="${escapeHtml(alt || label)}"
            data-fallback="${escapeHtml(DEFAULT_IMAGE_PLACEHOLDER)}"
            onerror="this.onerror=null;this.src=this.dataset.fallback;"
          />
          <div class="image-preview-copy">
            <strong>Live preview</strong>
            <p>${escapeHtml(helper || 'Direct image URLs keep vehicle and content images lightweight and easy to manage.')}</p>
            <small class="helper" id="${escapeHtml(statusId)}">${escapeHtml(statusText)}</small>
          </div>
        </div>
      </label>
    `;
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
    } catch (_) {
      return { message: 'Unable to connect to server. Please try again later.' };
    }
  }

  function normalizeRequestError(error) {
    if (error?.name === 'AbortError') {
      return new Error('Server temporarily unavailable. Please try again later.');
    }

    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network') || message.includes('load failed')) {
      return new Error('Server temporarily unavailable. Please try again later.');
    }

    return error instanceof Error ? error : new Error('Request failed');
  }

  async function apiFetch(path, options = {}) {
    let response;

    try {
      const url = `${API_BASE_URL}${path}`;
      logFetchRequest(url, options);
      response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(options.headers || {}),
          ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
        }
      });
      await logFetchResponse(url, options, response);
    } catch (error) {
      logFetchError(`${API_BASE_URL}${path}`, options, error);
      throw normalizeRequestError(error);
    }

    const body = await safeJson(response);
    if (!response.ok) {
      const message = body?.message || body?.error || 'Unable to connect to server. Please try again later.';
      throw new Error(message);
    }
    return body;
  }

  function setLoading(isLoading, label = 'Loading...') {
    state.busy = isLoading;
    el.loginButton.disabled = isLoading;
    el.loginButton.classList.toggle('is-loading', isLoading);
    el.loginButton.querySelector('.btn-text').textContent = isLoading ? label : 'Sign in';
  }

  function setLoginError(message) {
    if (!message) {
      el.loginError.hidden = true;
      el.loginError.textContent = '';
      return;
    }
    el.loginError.hidden = false;
    el.loginError.textContent = message;
  }

  function setSession(token, admin, remember) {
    state.token = token || '';
    state.admin = admin || null;
    if (remember) {
      if (token) localStorage.setItem(STORAGE_TOKEN, token); else localStorage.removeItem(STORAGE_TOKEN);
      writeJSON(STORAGE_ADMIN, admin);
    } else {
      if (token) sessionStorage.setItem(STORAGE_TOKEN, token); else sessionStorage.removeItem(STORAGE_TOKEN);
      sessionStorage.setItem(STORAGE_ADMIN, JSON.stringify(admin));
    }
    if (!token) {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_ADMIN);
      sessionStorage.removeItem(STORAGE_TOKEN);
      sessionStorage.removeItem(STORAGE_ADMIN);
    }
    updateHeaderIdentity();
  }

  function renderShellNotifications() {
    const items = (state.notifications || []).slice(0, 6);
    const unreadCount = state.notificationUnreadCount || items.filter((item) => !item.readAt && !item.isRead).length;

    if (el.notificationCount) {
      el.notificationCount.hidden = !unreadCount;
      el.notificationCount.textContent = String(unreadCount || 0);
    }

    if (el.notificationList) {
      el.notificationList.innerHTML = items.length
        ? items.map((item) => `
          <button type="button" class="notification-item" data-view="notifications">
            <span class="notification-item__icon ${item.readAt ? 'is-read' : ''}"><i class="fa-solid fa-bell"></i></span>
            <span class="notification-item__copy">
              <strong>${escapeHtml(item.title || item.type || 'Notification')}</strong>
              <span>${escapeHtml(item.message || 'Update available')}</span>
              <small>${escapeHtml(getNotificationSummary(item).customerName)} · ${escapeHtml(getNotificationSummary(item).rideType)}${getNotificationSummary(item).vehicle ? ` · ${escapeHtml(getNotificationSummary(item).vehicle)}` : ''}</small>
              <small>${escapeHtml(getNotificationSummary(item).bookingStatus || 'Pending')} · ${escapeHtml(fmtDateTime(item.createdAt))}</small>
            </span>
          </button>
        `).join('')
        : '<div class="empty-state empty-state--compact">No notifications yet.</div>';
    }
  }

  function updateHeaderIdentity() {
    const name = getAdminName();
    const email = getAdminEmail();
    const initials = getInitials(name);
    el.adminName.textContent = name;
    el.adminChip.textContent = name;
    if (el.adminAvatar) el.adminAvatar.textContent = initials;
    if (el.sidebarAvatar) el.sidebarAvatar.textContent = initials;
    if (el.sidebarAdminName) el.sidebarAdminName.textContent = name;
    if (el.sidebarAdminEmail) el.sidebarAdminEmail.textContent = email;
    renderShellNotifications();
  }

  function syncTopbarSurface() {
    if (!el.topbar) return;
    el.topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  }

  function isMobileDrawerMode() {
    return window.matchMedia('(max-width: 767px)').matches;
  }

  function setSidebarBackdropVisible(visible) {
    if (!el.sidebarBackdrop) return;
    el.sidebarBackdrop.hidden = !visible;
  }

  function getActiveBookingFilters() {
    return {
      search: '',
      status: '',
      paymentStatus: '',
      vehicle: '',
      fromDate: '',
      toDate: '',
      ...(state.bookingFilters || {})
    };
  }

  function getBookingVehicleOptions() {
    const values = new Set();
    (state.bookings || []).forEach((booking) => {
      const vehicle = String(booking.selectedCar || booking.vehicleId || '').trim();
      if (vehicle) values.add(vehicle);
    });
    return [...values].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
  }

  function buildBookingQueryParams({ exportMode = false } = {}) {
    const filters = getActiveBookingFilters();
    const query = new URLSearchParams();
    if (filters.search) query.set('search', filters.search);
    if (filters.status) query.set('status', filters.status);
    if (filters.paymentStatus) query.set('paymentStatus', filters.paymentStatus);
    if (filters.vehicle) query.set('vehicle', filters.vehicle);
    if (filters.fromDate) query.set('fromDate', filters.fromDate);
    if (filters.toDate) query.set('toDate', filters.toDate);
    query.set('limit', '50');
    query.set('sort', '-createdAt');
    if (exportMode) query.set('export', '1');
    return query;
  }

  function setBookingFilters(partialFilters = {}, { replace = false } = {}) {
    const current = replace ? {} : getActiveBookingFilters();
    state.bookingFilters = {
      ...current,
      ...partialFilters
    };
  }

  function resetBookingFilters() {
    state.bookingFilters = {
      search: '',
      status: '',
      paymentStatus: '',
      vehicle: '',
      fromDate: '',
      toDate: ''
    };
  }

  function getBookingFilterChips(filters = getActiveBookingFilters()) {
    const chips = [];
    if (filters.search) chips.push({ key: 'search', label: `Search: ${filters.search}` });
    if (filters.status) chips.push({ key: 'status', label: `Status: ${filters.status}` });
    if (filters.paymentStatus) chips.push({ key: 'paymentStatus', label: `Payment: ${filters.paymentStatus}` });
    if (filters.vehicle) chips.push({ key: 'vehicle', label: `Vehicle: ${filters.vehicle}` });
    if (filters.fromDate || filters.toDate) {
      const from = filters.fromDate ? fmtDate(filters.fromDate) : 'Any';
      const to = filters.toDate ? fmtDate(filters.toDate) : 'Any';
      chips.push({ key: 'date', label: `Date: ${from} → ${to}` });
    }
    return chips;
  }

  function renderBookingFilterControls(filters = getActiveBookingFilters(), compact = false) {
    const statusOptions = ['', 'Pending', 'Approved', 'Rejected', 'Driver Assigned', 'Ride Started', 'Ride Completed', 'Invoice Generated', 'Paid', 'Cancelled'];
    const paymentOptions = ['', 'Pending', 'Partial', 'Paid', 'Refunded'];
    const vehicleOptions = getBookingVehicleOptions();
    const fieldClass = compact ? 'field wide booking-filter-field' : 'field booking-filter-field';

    return `
      <label class="${fieldClass}">
        <span>Status</span>
        <select data-booking-filter-field="status">
          <option value="">All statuses</option>
          ${statusOptions.filter(Boolean).map((status) => `<option value="${escapeHtml(status)}" ${filters.status === status ? 'selected' : ''}>${escapeHtml(status)}</option>`).join('')}
        </select>
      </label>
      <label class="${fieldClass}">
        <span>Payment</span>
        <select data-booking-filter-field="paymentStatus">
          <option value="">All payment states</option>
          ${paymentOptions.filter(Boolean).map((paymentStatus) => `<option value="${escapeHtml(paymentStatus)}" ${filters.paymentStatus === paymentStatus ? 'selected' : ''}>${escapeHtml(paymentStatus)}</option>`).join('')}
        </select>
      </label>
      <label class="${fieldClass}">
        <span>Vehicle</span>
        <select data-booking-filter-field="vehicle">
          <option value="">All vehicles</option>
          ${vehicleOptions.map((vehicle) => `<option value="${escapeHtml(vehicle)}" ${filters.vehicle === vehicle ? 'selected' : ''}>${escapeHtml(vehicle)}</option>`).join('')}
        </select>
      </label>
      <label class="${fieldClass}">
        <span>From</span>
        <input type="date" data-booking-filter-field="fromDate" value="${escapeHtml(filters.fromDate || '')}" />
      </label>
      <label class="${fieldClass}">
        <span>To</span>
        <input type="date" data-booking-filter-field="toDate" value="${escapeHtml(filters.toDate || '')}" />
      </label>
    `;
  }

  function renderBookingToolbar() {
    if (!el.topbarSearchSlot) return;
    if (state.view !== 'bookings') {
      el.topbarSearchSlot.innerHTML = `
        <label class="search-pill" aria-label="Search current view">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="globalSearch" type="search" placeholder="Search current view" value="${escapeHtml(state.search)}" />
        </label>
      `;
      return;
    }

    // Keep topbar clean for bookings; booking filters are rendered in the page content.
    el.topbarSearchSlot.innerHTML = '';
  }

  function getBookingToolbarMarkup() {
    const filters = getActiveBookingFilters();
    return `
      <div class="booking-toolbar" data-booking-toolbar>
        <label class="search-pill booking-search-pill" aria-label="Search bookings">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input id="bookingSearchInput" data-booking-filter-field="search" type="search" placeholder="Search bookings" value="${escapeHtml(filters.search)}" />
        </label>
        <div class="booking-toolbar__filters booking-toolbar__filters--inline">
          ${renderBookingFilterControls(filters, false)}
        </div>
        <div class="booking-toolbar__actions">
          <button type="button" class="secondary-btn" data-booking-clear-filters>Clear filters</button>
          <button type="button" class="primary-btn" data-booking-export>Export</button>
        </div>
      </div>
    `;
  }

  function renderTopbarSurface() {
    syncTopbarSurface();
    renderBookingToolbar();
  }

  function downloadTextFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  function bookingsToCsv(bookings = []) {
    const headers = ['Booking ID', 'Customer', 'Email', 'Phone', 'Pickup', 'Drop', 'Pickup Date', 'Vehicle', 'Driver', 'Status', 'Payment Status', 'Invoice', 'Total Fare', 'Created At'];
    const rows = bookings.map((booking) => [
      booking.bookingId,
      booking.customerName,
      booking.email,
      booking.phone,
      booking.pickupLocation,
      booking.dropLocation,
      booking.pickupDate ? fmtDate(booking.pickupDate) : '',
      booking.selectedCar || booking.vehicleId || '',
      booking.assignedDriver?.driverName || '',
      booking.bookingStatus || '',
      booking.paymentStatus || '',
      booking.invoiceId || booking.invoice?.invoiceId || '',
      booking.totalFare ?? booking.estimatedFare ?? '',
      booking.createdAt ? fmtDateTime(booking.createdAt) : ''
    ]);

    const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return [headers.map(escapeCell).join(','), ...rows.map((row) => row.map(escapeCell).join(','))].join('\n');
  }

  async function exportFilteredBookings() {
    const query = buildBookingQueryParams({ exportMode: true });
    const body = await apiFetch(`/api/admin/bookings?${query.toString()}`);
    const bookings = body.bookings || [];
    downloadTextFile(bookingsToCsv(bookings), `bookings-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
    toast('Export started', `${bookings.length} booking${bookings.length === 1 ? '' : 's'} exported`);
  }

  async function reloadBookings({ debounce = false } = {}) {
    if (state.bookingReloadTimer) {
      window.clearTimeout(state.bookingReloadTimer);
      state.bookingReloadTimer = null;
    }

    const run = async () => {
      state.bookings = null;
      await loadBookings(true);
      if (state.view === 'bookings') renderCurrentView();
    };

    if (debounce) {
      state.bookingReloadTimer = window.setTimeout(() => {
        state.bookingReloadTimer = null;
        run().catch((error) => toast('Load failed', error.message, 'error'));
      }, 260);
      return;
    }

    await run();
  }

  function syncSidebarMode() {
    if (!el.appShell) return;
    if (isMobileDrawerMode()) {
      el.appShell.classList.remove('sidebar-collapsed');
      el.appShell.classList.remove('sidebar-open');
      document.body.classList.remove('shell-open');
      setSidebarBackdropVisible(false);
      return;
    }

    el.appShell.classList.remove('sidebar-open');
    document.body.classList.remove('shell-open');
    setSidebarBackdropVisible(false);

    if (window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches) {
      el.appShell.classList.add('sidebar-collapsed');
    } else if (window.matchMedia('(min-width: 1025px)').matches) {
      el.appShell.classList.remove('sidebar-collapsed');
    }
  }

  function disconnectRealtimeSocket() {
    if (!state.socket) return;
    state.socket.removeAllListeners?.();
    state.socket.disconnect();
    state.socket = null;
  }

  function handleRealtimeNotification(payload = {}) {
    const notification = payload.notification || payload;
    const eventName = payload.eventName || 'notification:new';
    if (notification?._id) {
      upsertRealtimeNotification(notification);
    }

    const shouldRefreshBookings = ['booking:new', 'booking:status-updated', 'booking:driver-assigned', 'booking:cancelled', 'invoice:generated', 'invoice:resent', 'invoice:updated', 'payment:completed', 'payment:received', 'payment:updated'].includes(eventName);
    const shouldRefreshDashboard = shouldRefreshBookings || ['payment:refunded'].includes(eventName);

    if (shouldRefreshBookings) state.bookings = null;
    if (shouldRefreshDashboard) state.dashboard = null;

    const title = notification?.title || payload?.title || 'Live update';
    const message = notification?.message || payload?.message || 'Dashboard updated';
    toast(title, message, 'success');

    if (state.view === 'notifications') {
      void loadNotifications(true).then(() => renderCurrentView()).catch(() => undefined);
      return;
    }

    if (state.view === 'bookings' && shouldRefreshBookings) {
      void refreshView();
      return;
    }

    if (state.view === 'dashboard' && shouldRefreshDashboard) {
      void refreshView();
      return;
    }

    if (shouldRefreshDashboard) void loadDashboard(true).catch(() => undefined);
    if (shouldRefreshBookings) void loadBookings(true).catch(() => undefined);
    void loadNotifications(true).catch(() => undefined);
  }

  function connectRealtimeSocket() {
    if (!window.io || !state.token) return;

    disconnectRealtimeSocket();
    state.socket = window.io(SOCKET_BASE_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: { token: state.token }
    });

    state.socket.on('connect', () => {
      state.socket.emit('join:admin');
    });

    state.socket.on('notification:new', (payload) => handleRealtimeNotification(payload));
  }

  function toggleSidebarShell() {
    if (!el.appShell) return;
    if (isMobileDrawerMode()) {
      const isOpen = el.appShell.classList.toggle('sidebar-open');
      document.body.classList.toggle('shell-open', isOpen);
      setSidebarBackdropVisible(isOpen);
      return;
    }
    el.appShell.classList.toggle('sidebar-collapsed');
  }

  function showLogin() {
    el.loginView.hidden = false;
    el.appView.hidden = true;
  }

  function showApp() {
    el.loginView.hidden = true;
    el.appView.hidden = false;
  }

  function setView(view) {
    state.view = view;
    const navRoot = el.sidebarNavRoot || el.sideNav;
    navRoot?.querySelectorAll('.nav-item[data-view]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
    const labels = {
      dashboard: ['Dashboard', 'Luxury Operations Overview'],
      bookings: ['Bookings', 'Booking Management'],
      drivers: ['Drivers', 'Driver Management'],
      cars: ['Cars', 'Fleet Management'],
      packages: ['Packages', 'Tour Package Management'],
      routes: ['Routes', 'Route Pricing Management'],
      customers: ['Customers', 'Customer Operations'],
      payments: ['Payments', 'Transaction Control'],
      invoices: ['Invoices', 'Invoice Management'],
      messages: ['Messages', 'Inquiry Inbox'],
      content: ['Website Content', 'Brand & Homepage Control'],
      analytics: ['Analytics', 'Business Intelligence'],
      settings: ['Settings', 'Admin Settings'],
      notifications: ['Notifications', 'Live Notification Center']
    };
    el.viewLabel.textContent = labels[view]?.[0] || 'Dashboard';
    el.viewTitle.textContent = labels[view]?.[1] || 'Luxury Operations Overview';
    renderCurrentView();
  }

  function openModal(title, body, eyebrow = 'Edit') {
    el.modalTitle.textContent = title;
    el.modalEyebrow.textContent = eyebrow;
    el.modalBody.innerHTML = body;
    const form = el.modalBody.querySelector('form[data-save-entity]');
    if (form) {
      form.addEventListener('submit', handleEntityFormSubmit);
    }
    el.modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function renderDriverOptions(drivers, selectedDriverId = '') {
    return drivers.map((driver) => {
      const label = `${driver.driverName}${driver.availability ? '' : ' (busy)'}`;
      return `<option value="${escapeHtml(driver._id)}" ${String(driver._id) === String(selectedDriverId) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  async function handleEntityFormSubmit(event) {
    const form = event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    await submitEntityForm(form);
  }

  function closeModal() {
    el.modalBackdrop.hidden = true;
    el.modalBody.innerHTML = '';
    document.body.style.overflow = '';
  }

  async function openWorkflowModal({ title, eyebrow = 'Edit', body, onSubmit }) {
    openModal(title, body, eyebrow);
    const form = el.modalBody.querySelector('form[data-workflow-form]');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const submitButton = form.querySelector('button[type="submit"]');
      const previousLabel = submitButton?.textContent || '';
      if (submitButton) submitButton.disabled = true;

      try {
        await onSubmit(form);
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = previousLabel;
        }
      }
    }, { once: true });
  }

  function formDataFromObject(fields, fileInputNames = []) {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, value);
    });
    fileInputNames.forEach((name) => {
      const fileInput = el.modalBody.querySelector(`[name="${name}"]`);
      if (fileInput && fileInput.files && fileInput.files[0]) {
        formData.append(name, fileInput.files[0]);
      }
    });
    return formData;
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return String(value).split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getBookingChargeItems(booking) {
    if (!booking) return [];
    const builtIns = [
      ['Toll Charges', booking.tollCharges],
      ['Parking Charges', booking.parkingCharges],
      ['Driver Allowance', booking.driverAllowance],
      ['Waiting Charges', booking.waitingCharges],
      ['Night Charges', booking.nightCharges],
      ['State Permit Charges', booking.statePermitCharges],
      ['Extra Distance Charges', booking.extraDistanceCharges],
      ['Miscellaneous Charges', booking.miscellaneousCharges]
    ];

    const charges = builtIns
      .map(([name, amount]) => ({ name, amount: toNumber(amount, 0) }))
      .filter((item) => item.amount > 0);

    (Array.isArray(booking.extraCharges) ? booking.extraCharges : []).forEach((item) => {
      const name = String(item?.name || item?.label || item?.title || '').trim();
      const amount = toNumber(item?.amount, 0);
      if (name && amount > 0) charges.push({ name, amount });
    });

    return charges;
  }

  function renderChargeRow(charge = {}, index = 0) {
    return `
      <div class="invoice-charge-row" data-charge-row>
        <label class="field wide"><span>Charge name</span><input name="chargeName" value="${escapeHtml(charge.name || '')}" placeholder="Airport Parking" /></label>
        <label class="field wide"><span>Amount</span><input name="chargeAmount" type="number" min="0" step="1" value="${escapeHtml(String(charge.amount || 0))}" /></label>
        <button class="small-btn danger invoice-charge-remove" type="button" data-charge-remove data-index="${index}">Remove</button>
      </div>
    `;
  }

  function renderChargeRows(chargeItems = []) {
    const rows = chargeItems.length ? chargeItems.map((item, index) => renderChargeRow(item, index)).join('') : renderChargeRow({}, 0);
    return `<div class="invoice-charge-list" data-charge-list>${rows}</div>`;
  }

  function readChargeRows(container) {
    return Array.from(container.querySelectorAll('[data-charge-row]')).map((row) => {
      const name = String(row.querySelector('[name="chargeName"]')?.value || '').trim();
      const amount = toNumber(row.querySelector('[name="chargeAmount"]')?.value, 0);
      if (!name || amount <= 0) return null;
      return { name, amount };
    }).filter(Boolean);
  }

  function calculateInvoicePreview(booking, draft = {}) {
    const taxPercent = toNumber(booking.gstAmount ? 5 : (booking.fareBreakdown?.gstPercent || 5), 5);
    const baseFare = toNumber(booking.baseFare || booking.fareBreakdown?.baseFare || booking.estimatedFare || 0);
    const distanceFare = toNumber(booking.distanceFare || booking.fareBreakdown?.distanceFare || 0);
    const tripType = String(booking.fareBreakdown?.tripType || booking.tripType || '').toLowerCase();
    const packageLabel = booking.fareBreakdown?.packageLabel || (tripType === 'local-package' ? 'Local Package' : tripType === 'half-day-package' ? 'Half Day Package' : tripType === 'airport-transfer' ? 'Airport Pickup / Drop' : tripType === 'outstation-package' ? 'Outstation Package' : tripType === 'wedding-vip-event' ? 'Wedding / VIP Events' : 'Base Fare');
    const distanceLabel = tripType === 'local-package' || tripType === 'half-day-package' ? 'Extra KM Charges' : tripType === 'airport-transfer' ? 'Airport Charges' : tripType === 'outstation-package' ? 'Extra KM Charges' : tripType === 'wedding-vip-event' ? 'Wedding / VIP Charges' : 'Distance Fare';
    const builtInCharges = [
      ['Toll Charges', toNumber(draft.tollCharges ?? booking.tollCharges, 0)],
      ['Parking Charges', toNumber(draft.parkingCharges ?? booking.parkingCharges, 0)],
      ['Driver Allowance', toNumber(draft.driverAllowance ?? booking.driverAllowance, 0)],
      ['Waiting Charges', toNumber(draft.waitingCharges ?? booking.waitingCharges, 0)],
      ['Night Charges', toNumber(draft.nightCharges ?? booking.nightCharges, 0)],
      ['State Permit Charges', toNumber(draft.statePermitCharges ?? booking.statePermitCharges, 0)],
      ['Extra Distance Charges', toNumber(draft.extraDistanceCharges ?? booking.extraDistanceCharges, 0)],
      ['Miscellaneous Charges', toNumber(draft.miscellaneousCharges ?? booking.miscellaneousCharges, 0)]
    ].filter(([, amount]) => amount > 0).map(([name, amount]) => ({ name, amount }));

    const extraCharges = Array.isArray(draft.extraCharges) ? draft.extraCharges : getBookingChargeItems(booking).filter((item) => !builtInCharges.some((builtIn) => builtIn.name === item.name && builtIn.amount === item.amount));
    const extraChargesTotal = extraCharges.reduce((total, item) => total + toNumber(item.amount, 0), 0);
    const builtInTotal = builtInCharges.reduce((total, item) => total + toNumber(item.amount, 0), 0);
    const subtotalBeforeDiscount = baseFare + distanceFare + builtInTotal + extraChargesTotal;

    const discountType = String(draft.discountType || booking.discountType || 'flat').toLowerCase();
    const discountValue = toNumber(draft.discountValue ?? booking.discountValue ?? booking.discountAmount ?? 0, 0);
    let discountAmount = toNumber(draft.discountAmount ?? booking.discountAmount ?? 0, 0);
    if (!discountAmount && discountValue > 0) {
      discountAmount = discountType === 'percentage' ? Math.round((subtotalBeforeDiscount * discountValue) / 100) : discountValue;
    }

    const subtotal = Math.max(0, subtotalBeforeDiscount - discountAmount);
    const gstAmount = Math.max(0, Math.round(subtotal * (taxPercent / 100)));
    const manualGrandTotal = toNumber(draft.grandTotal, 0);
    const grandTotal = manualGrandTotal > 0 ? manualGrandTotal : subtotal + gstAmount;
    const paymentStatus = String(draft.paymentStatus || booking.paymentStatus || 'Pending');
    const paidAmount = toNumber(draft.paidAmount ?? (paymentStatus === 'Paid' ? grandTotal : 0), 0);
    const balanceAmount = Math.max(0, grandTotal - paidAmount);
    const paymentDate = draft.paymentDate || (paymentStatus === 'Paid' ? new Date().toISOString().slice(0, 10) : '');

    const rows = [
      { description: packageLabel, quantity: 1, rate: baseFare, amount: baseFare },
      { description: distanceLabel, quantity: 1, rate: distanceFare, amount: distanceFare }
    ];

    builtInCharges.forEach((item) => rows.push({ description: item.name, quantity: 1, rate: item.amount, amount: item.amount }));
    extraCharges.forEach((item) => rows.push({ description: item.name, quantity: 1, rate: item.amount, amount: item.amount }));
    if (discountAmount > 0) rows.push({ description: discountType === 'percentage' ? `Discount (${discountValue}%)` : 'Discount', quantity: 1, rate: discountAmount, amount: -discountAmount, isDiscount: true });
    rows.push({ description: `GST (${taxPercent}%)`, quantity: 1, rate: subtotal, amount: gstAmount, isTax: true });

    return {
      baseFare,
      distanceFare,
      builtInCharges,
      extraCharges,
      subtotalBeforeDiscount,
      discountType,
      discountValue,
      discountAmount,
      subtotal,
      gstAmount,
      grandTotal,
      paymentStatus,
      paidAmount,
      balanceAmount,
      paymentDate,
      rows
    };
  }

  function renderInvoicePreviewHtml(booking, draft = {}) {
    const preview = calculateInvoicePreview(booking, draft);
    const rows = preview.rows.map((row) => `
      <tr class="${row.isDiscount ? 'is-discount' : row.isTax ? 'is-tax' : ''}">
        <td data-label="Description">${escapeHtml(row.description)}</td>
        <td data-label="Qty">${escapeHtml(String(row.quantity || 1))}</td>
        <td data-label="Rate">${fmtMoney(row.rate || 0)}</td>
        <td data-label="Amount">${fmtMoney(row.amount || 0)}</td>
      </tr>
    `).join('');

    return {
      preview,
      html: `
        <div class="invoice-preview-stack">
          <table class="data-table invoice-preview-table">
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="invoice-preview-summary">
            <div><span>Subtotal</span><strong>${fmtMoney(preview.subtotal)}</strong></div>
            <div><span>Extra charges</span><strong>${fmtMoney(preview.extraCharges.reduce((total, item) => total + toNumber(item.amount, 0), 0) + preview.builtInCharges.reduce((total, item) => total + toNumber(item.amount, 0), 0))}</strong></div>
            <div><span>Discount</span><strong>${fmtMoney(preview.discountAmount)}</strong></div>
            <div><span>GST</span><strong>${fmtMoney(preview.gstAmount)}</strong></div>
            <div class="grand-total"><span>Grand total</span><strong>${fmtMoney(preview.grandTotal)}</strong></div>
          </div>
        </div>
      `
    };
  }

  async function getBookingForInvoiceEditor(id) {
    const existing = (state.bookings || []).find((booking) => booking._id === id);
    if (existing) return existing;

    await loadBookings(true);
    const loaded = (state.bookings || []).find((booking) => booking._id === id);
    if (loaded) return loaded;

    throw new Error('Booking not found');
  }

  function buildInvoiceEditorMarkup(booking) {
    const preview = renderInvoicePreviewHtml(booking, {
      extraCharges: getBookingChargeItems(booking),
      discountType: booking.discountType || 'flat',
      discountValue: booking.discountValue || 0,
      discountAmount: booking.discountAmount || 0,
      grandTotal: booking.grandTotal || booking.totalFare || 0,
      paymentStatus: booking.paymentStatus || 'Pending',
      paidAmount: booking.paidAmount || 0,
      paymentDate: booking.paymentDate ? String(booking.paymentDate).slice(0, 10) : ''
    });

    const paymentStatuses = ['Pending', 'Partial', 'Paid', 'Refunded'];
    const paymentMethods = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Online payment link'];
    const chargeMarkup = renderChargeRows(
      getBookingChargeItems(booking).filter((item) => !['Toll Charges', 'Parking Charges', 'Driver Allowance', 'Waiting Charges', 'Night Charges', 'State Permit Charges', 'Extra Distance Charges', 'Miscellaneous Charges'].includes(item.name))
    );

    return `
      <form class="auth-form invoice-editor-form" data-invoice-editor-form data-booking-id="${escapeHtml(booking._id)}">
        <div class="invoice-editor-grid">
          <section class="card invoice-editor-card">
            <div class="card-header"><div><h3>Invoice editor</h3><p>${escapeHtml(booking.bookingId)} · ${escapeHtml(booking.customerName)}</p></div></div>
            <div class="form-grid">
              <label class="field wide"><span>Discount type</span>
                <select name="discountType">
                  <option value="flat" ${String(booking.discountType || 'flat') === 'flat' ? 'selected' : ''}>Flat amount</option>
                  <option value="percentage" ${String(booking.discountType || '') === 'percentage' ? 'selected' : ''}>Percentage</option>
                </select>
              </label>
              <label class="field wide"><span>Discount value</span><input type="number" min="0" name="discountValue" value="${escapeHtml(String(booking.discountValue || 0))}" /></label>
              <label class="field wide"><span>Manual final fare</span><input type="number" min="0" name="grandTotal" value="${escapeHtml(String(booking.grandTotal || booking.totalFare || 0))}" /></label>
              <label class="field wide"><span>Payment status</span>
                <select name="paymentStatus">
                  ${paymentStatuses.map((status) => `<option value="${status}" ${String(booking.paymentStatus || 'Pending') === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
              </label>
              <label class="field wide"><span>Payment method</span>
                <select name="paymentMethod">
                  ${paymentMethods.map((method) => `<option value="${method}" ${String(booking.paymentMethod || 'Cash') === method ? 'selected' : ''}>${method}</option>`).join('')}
                </select>
              </label>
              <label class="field wide"><span>Payment date</span><input type="date" name="paymentDate" value="${escapeHtml(booking.paymentDate ? String(new Date(booking.paymentDate).toISOString()).slice(0, 10) : '')}" /></label>
              <label class="field wide"><span>Transaction reference</span><input name="transactionId" value="${escapeHtml(booking.transactionId || '')}" placeholder="UPI reference, receipt number, etc." /></label>
            </div>
          </section>

          <section class="card invoice-editor-card">
            <div class="card-header"><div><h3>Charges</h3><p>Add, remove, and edit billing items before generating the invoice</p></div><button class="small-btn primary" type="button" data-add-charge>Add charge</button></div>
            ${chargeMarkup}
          </section>

          <section class="card invoice-editor-card invoice-preview-card">
            <div class="card-header"><div><h3>Live preview</h3><p>Updated as you type</p></div></div>
            <div data-invoice-preview>${preview.html}</div>
          </section>
        </div>

        <div class="form-actions invoice-editor-actions">
          <button class="primary-btn" type="submit" data-save-draft>Save draft</button>
          <button class="secondary-btn" type="button" data-generate-invoice>Generate invoice</button>
          <button class="secondary-btn" type="button" data-close-modal>Cancel</button>
        </div>
      </form>
    `;
  }

  async function saveInvoiceEditorDraft(form, shouldGenerate = false) {
    const bookingId = form.dataset.bookingId;
    const draft = {
      discountType: form.querySelector('[name="discountType"]')?.value || 'flat',
      discountValue: toNumber(form.querySelector('[name="discountValue"]')?.value, 0),
      grandTotal: toNumber(form.querySelector('[name="grandTotal"]')?.value, 0),
      paymentStatus: form.querySelector('[name="paymentStatus"]')?.value || 'Pending',
      paymentMethod: form.querySelector('[name="paymentMethod"]')?.value || 'Cash',
      paymentDate: form.querySelector('[name="paymentDate"]')?.value || '',
      transactionId: form.querySelector('[name="transactionId"]')?.value || '',
      extraCharges: readChargeRows(form.querySelector('[data-charge-list]'))
    };

    const body = await apiFetch(`/api/admin/bookings/${bookingId}/invoice-draft`, {
      method: 'PATCH',
      body: JSON.stringify(draft)
    });

    state.bookings = null;
    state.invoices = null;
    state.dashboard = null;

    if (shouldGenerate) {
      await apiFetch(`/api/admin/bookings/${bookingId}/generate-invoice`, { method: 'POST' });
    }

    closeModal();
    await refreshView();
    toast('Invoice updated', body.message || 'Draft saved');
  }

  async function openInvoiceEditor(id) {
    const booking = await getBookingForInvoiceEditor(id);
    const markup = buildInvoiceEditorMarkup(booking);
    openModal('Invoice editor', markup, 'Billing workflow');

    const form = el.modalBody.querySelector('[data-invoice-editor-form]');
    const previewRoot = el.modalBody.querySelector('[data-invoice-preview]');
    const chargeList = el.modalBody.querySelector('[data-charge-list]');
    const addChargeButton = el.modalBody.querySelector('[data-add-charge]');
    const generateButton = el.modalBody.querySelector('[data-generate-invoice]');

    function refreshPreview() {
      const preview = renderInvoicePreviewHtml(booking, {
        discountType: form.querySelector('[name="discountType"]')?.value || 'flat',
        discountValue: toNumber(form.querySelector('[name="discountValue"]')?.value, 0),
        grandTotal: toNumber(form.querySelector('[name="grandTotal"]')?.value, 0),
        paymentStatus: form.querySelector('[name="paymentStatus"]')?.value || 'Pending',
        paymentMethod: form.querySelector('[name="paymentMethod"]')?.value || 'Cash',
        paymentDate: form.querySelector('[name="paymentDate"]')?.value || '',
        transactionId: form.querySelector('[name="transactionId"]')?.value || '',
        extraCharges: readChargeRows(chargeList)
      });
      previewRoot.innerHTML = preview.html;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveInvoiceEditorDraft(form, false);
    });

    generateButton?.addEventListener('click', async () => {
      await saveInvoiceEditorDraft(form, true);
    });

    addChargeButton?.addEventListener('click', () => {
      const currentCharges = readChargeRows(chargeList);
      chargeList.insertAdjacentHTML('beforeend', renderChargeRow({}, currentCharges.length));
      refreshPreview();
    });

    chargeList?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-charge-remove]');
      if (!removeButton) return;
      const row = removeButton.closest('[data-charge-row]');
      if (row) row.remove();
      if (!chargeList.querySelector('[data-charge-row]')) {
        chargeList.insertAdjacentHTML('beforeend', renderChargeRow({}, 0));
      }
      refreshPreview();
    });

    form.addEventListener('input', refreshPreview);
    form.addEventListener('change', refreshPreview);
  }

  function renderBadge(value) {
    const text = String(value || '—');
    const lower = text.toLowerCase();
    let klass = 'badge--info';
    if (lower.includes('cancel') || lower.includes('reject') || lower.includes('fail')) klass = 'badge--danger';
    else if (lower.includes('payment pending')) klass = 'badge--payment';
    else if (lower.includes('pending') || lower.includes('open')) klass = 'badge--warning';
    else if (lower.includes('approved') || lower.includes('accepted') || lower.includes('assigned')) klass = 'badge--approved';
    else if (lower.includes('paid') || lower.includes('completed') || lower.includes('resolved') || lower.includes('available')) klass = 'badge--success';
    return `<span class="badge ${klass}">${escapeHtml(text)}</span>`;
  }

  function renderButtons(buttons) {
    return `<div class="row-actions">${buttons.join('')}</div>`;
  }

  function tableShell(headers, rowsHtml, emptyText = 'No records found', mobileCardsHtml = '') {
    if (!rowsHtml) {
      return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="table-shell">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        ${mobileCardsHtml ? `<div class="mobile-table-cards">${mobileCardsHtml}</div>` : ''}
      </div>
    `;
  }

  function renderTableCardField(label, value, { html = false, full = false } = {}) {
    const content = html ? String(value || '—') : escapeHtml(value || '—');
    return `
      <div class="mobile-table-card__field${full ? ' mobile-table-card__field--full' : ''}">
        <span>${escapeHtml(label)}</span>
        <strong>${content}</strong>
      </div>
    `;
  }

  function renderTableCard({ title, subtitle = '', eyebrow = '', badges = [], fields = [], actions = '' }) {
    return `
      <article class="mobile-table-card card">
        <div class="mobile-table-card__header">
          <div>
            ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
            <h4>${escapeHtml(title)}</h4>
            ${subtitle ? `<p class="mobile-table-card__subtitle">${subtitle}</p>` : ''}
          </div>
          ${badges.length ? `<div class="mobile-table-card__badges">${badges.join('')}</div>` : ''}
        </div>
        <div class="mobile-table-card__fields">
          ${fields.map((field) => renderTableCardField(field.label, field.value, field)).join('')}
        </div>
        ${actions ? `<div class="mobile-table-card__actions">${actions}</div>` : ''}
      </article>
    `;
  }

  function statCard(icon, label, value, meta) {
    return `
      <article class="card dashboard-stat-row">
        <div class="metric-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="dashboard-stat-copy">
          <div class="metric-label">${escapeHtml(label)}</div>
          <h3 class="metric-value">${escapeHtml(value)}</h3>
          <div class="metric-meta">${escapeHtml(meta || '')}</div>
        </div>
        <div class="dashboard-stat-rail"></div>
      </article>
    `;
  }

  function ensureChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return null;
    const existing = state.charts[canvasId];
    if (existing) existing.destroy();
    const chart = new window.Chart(canvas.getContext('2d'), config);
    state.charts[canvasId] = chart;
    return chart;
  }

  function mapSeries(items, valueKey = 'total') {
    return (items || []).map((item) => ({
      label: item._id || item.label || 'N/A',
      value: Number(item[valueKey] || 0)
    }));
  }

  function chartLabels(items) {
    return mapSeries(items).map((item) => item.label);
  }

  function chartValues(items) {
    return mapSeries(items).map((item) => item.value);
  }

  function renderDashboard() {
    const dashboard = state.dashboard;
    if (!dashboard) {
      el.viewRoot.innerHTML = '<div class="loading-state">Loading dashboard...</div>';
      return;
    }

    const stats = dashboard.stats || {};
    const recentBookings = dashboard.recentBookings || [];
    const recentPayments = dashboard.recentPayments || [];
    const recentMessages = dashboard.recentMessages || [];
    const notifications = dashboard.notifications || [];
    const notificationCards = notifications.map((item) => renderTableCard({
      title: item.title || item.type || 'Notification',
      subtitle: item.message || 'Update available',
      eyebrow: fmtDateTime(item.createdAt),
      fields: [
        { label: 'Customer', value: getNotificationSummary(item).customerName },
        { label: 'Ride', value: getNotificationSummary(item).rideType },
        { label: 'Status', value: getNotificationSummary(item).bookingStatus || 'Pending' }
      ],
      badges: [renderBadge(item.readAt ? 'Read' : 'Unread')]
    })).join('');

    el.viewRoot.innerHTML = `
      <div class="view view-dashboard">
        <section class="card dashboard-hero">
          <div class="card-header dashboard-hero-header">
            <div>
              <p class="eyebrow">Dashboard snapshot</p>
              <h3>Luxury operations overview</h3>
            </div>
            <div class="helper">Live status and activity summary</div>
          </div>

          <div class="dashboard-stat-list">
            ${statCard('fa-calendar-check', 'Total bookings', stats.totalBookings || 0, `${stats.pendingRides || 0} pending rides`)}
            ${statCard('fa-user-shield', 'Active drivers', stats.activeDrivers || 0, `${stats.acceptedRides || 0} accepted rides`)}
            ${statCard('fa-indian-rupee-sign', 'Revenue', fmtMoney(stats.revenue || 0), `${stats.pendingPayments || 0} pending payments`)}
            ${statCard('fa-users', 'Customers', stats.totalCustomers || 0, `${stats.blockedCustomers || 0} blocked accounts`)}
          </div>
        </section>

        <section class="dashboard-feed">
          <section class="dashboard-chart-row">
            <article class="card chart-card">
              <div class="card-header"><div><h3>Revenue trend</h3><p>Monthly completed payment totals</p></div></div>
              <div class="chart-box"><canvas id="revenueChart"></canvas></div>
            </article>

            <article class="card chart-card">
              <div class="card-header"><div><h3>Booking trend</h3><p>Monthly booking activity</p></div></div>
              <div class="chart-box"><canvas id="bookingChart"></canvas></div>
            </article>
          </section>

          <article class="card stack-card">
            <div class="card-header"><div><h4>Recent bookings</h4><p>Live operational queue</p></div></div>
            <div class="notice-list">
              ${recentBookings.map((booking) => `<div class="notice-item"><strong>${escapeHtml(booking.bookingId || '—')}</strong><span>${escapeHtml(booking.customerName || '')}</span><span class="helper">${escapeHtml(booking.pickupLocation || '')} → ${escapeHtml(booking.dropLocation || '')}</span><div>${renderBadge(booking.bookingStatus || booking.paymentStatus)}</div></div>`).join('') || '<div class="empty-state">No bookings yet.</div>'}
            </div>
          </article>

          <article class="card stack-card">
            <div class="card-header"><div><h4>Recent payments</h4><p>Settlement activity</p></div></div>
            <div class="notice-list">
              ${recentPayments.map((payment) => `<div class="notice-item"><strong>${escapeHtml(payment.booking?.bookingId || payment.metadata?.bookingId || 'Payment')}</strong><span>${fmtMoney(payment.amount)}</span><span class="helper">${escapeHtml(payment.paymentType)} · ${escapeHtml(payment.status)}</span></div>`).join('') || '<div class="empty-state">No payments yet.</div>'}
            </div>
          </article>

          <article class="card stack-card">
            <div class="card-header"><div><h4>Inbox</h4><p>Newest inquiries</p></div></div>
            <div class="notice-list">
              ${recentMessages.map((message) => `<div class="notice-item"><strong>${escapeHtml(message.subject || 'General inquiry')}</strong><span>${escapeHtml(message.name || '')}</span><span class="helper">${escapeHtml(message.email || '')}</span></div>`).join('') || '<div class="empty-state">No messages yet.</div>'}
            </div>
          </article>

          <article class="card table-card">
            <div class="card-header"><div><h3>Notifications</h3><p>System alerts and live events</p></div></div>
            ${tableShell(['Title', 'Message', 'Time'], notifications.map((item) => `
              <tr>
                <td>${escapeHtml(item.title || item.type || 'Notification')}</td>
                <td>${escapeHtml(item.message || '')}</td>
                <td>${escapeHtml(fmtDateTime(item.createdAt))}</td>
              </tr>
            `).join(''), 'No notifications available', notificationCards)}
          </article>
        </section>
      </div>
    `;

    ensureChart('revenueChart', {
      type: 'line',
      data: {
        labels: chartLabels(dashboard.charts?.monthlyRevenue || []),
        datasets: [{ label: 'Revenue', data: chartValues(dashboard.charts?.monthlyRevenue || []), borderColor: '#6A1B9A', backgroundColor: 'rgba(106,27,154,0.18)', tension: 0.36, fill: true, pointBackgroundColor: '#D4AF37', pointBorderColor: '#ffffff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#4a2a63' }, grid: { color: 'rgba(106,27,154,0.10)' } }, x: { ticks: { color: '#4a2a63' }, grid: { display: false } } } }
    });

    ensureChart('bookingChart', {
      type: 'bar',
      data: {
        labels: chartLabels(dashboard.charts?.monthlyBookings || []),
        datasets: [{ label: 'Bookings', data: chartValues(dashboard.charts?.monthlyBookings || []), backgroundColor: 'rgba(212,175,55,0.72)', borderRadius: 10, borderSkipped: false }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#4a2a63' }, grid: { color: 'rgba(106,27,154,0.10)' } }, x: { ticks: { color: '#4a2a63' }, grid: { display: false } } } }
    });
  }

  async function loadDashboard() {
    const body = await apiFetch('/api/admin/dashboard');
    state.dashboard = body.dashboard || null;
    renderDashboard();
  }

  async function loadBookings(force = false) {
    if (state.bookings && !force) return state.bookings;
    const query = buildBookingQueryParams();
    const body = await apiFetch(`/api/admin/bookings?${query.toString()}`);
    state.bookings = body.bookings || [];
    return state.bookings;
  }

  async function loadDrivers(force = false) {
    if (state.drivers && !force) return state.drivers;
    const body = await apiFetch('/api/admin/drivers');
    state.drivers = body.drivers || [];
    return state.drivers;
  }

  async function loadCars(force = false) {
    if (state.cars && !force) return state.cars;
    const body = await apiFetch('/api/admin/cars');
    state.cars = body.cars || [];
    return state.cars;
  }

  async function loadPackages(force = false) {
    if (state.packages && !force) return state.packages;
    const body = await apiFetch('/api/admin/packages');
    state.packages = body.packages || [];
    return state.packages;
  }

  async function loadRoutes(force = false) {
    if (state.routes && !force) return state.routes;
    const body = await apiFetch('/api/admin/routes');
    state.routes = body.routes || [];
    return state.routes;
  }

  async function loadCustomers(force = false) {
    if (state.customers && !force) return state.customers;
    const body = await apiFetch('/api/admin/customers');
    state.customers = body.customers || [];
    return state.customers;
  }

  async function loadPayments(force = false) {
    if (state.payments && !force) return state.payments;
    const body = await apiFetch('/api/admin/payments');
    state.payments = body.payments || [];
    return state.payments;
  }

  async function loadInvoices(force = false) {
    if (state.invoices && !force) return state.invoices;
    const query = new URLSearchParams();
    if (state.search) query.set('search', state.search);
    const body = await apiFetch(`/api/admin/invoices?${query.toString()}`);
    state.invoices = body.invoices || [];
    return state.invoices;
  }

  async function loadMessages(force = false) {
    if (state.messages && !force) return state.messages;
    const body = await apiFetch('/api/admin/messages');
    state.messages = body.messages || [];
    return state.messages;
  }

  async function loadSettings(force = false) {
    if (state.settings && !force) return state.settings;
    const body = await apiFetch('/api/admin/settings');
    state.settings = body.settings || null;
    return state.settings;
  }

  async function loadNotifications(force = false) {
    if (state.notifications && !force) return state.notifications;
    const body = await apiFetch('/api/admin/notifications');
    state.notifications = body.notifications || [];
    state.notificationUnreadCount = Number(body.unreadCount || 0);
    renderShellNotifications();
    return state.notifications;
  }

  function renderBookingsView() {
    renderTopbarSurface();
    const bookings = state.bookings || [];
    const cards = bookings.map((booking) => renderTableCard({
      title: booking.bookingId || '—',
      subtitle: `${booking.pickupLocation || '—'} → ${booking.dropLocation || '—'}`,
      eyebrow: fmtDateTime(booking.createdAt),
      fields: [
        { label: 'Customer', value: booking.customerName || '—' },
        { label: 'Contact', value: `${escapeHtml(booking.email || '—')} ${booking.phone ? `<br>${escapeHtml(booking.phone)}` : ''}`, html: true },
        { label: 'Route', value: `${escapeHtml(booking.pickupDate ? fmtDate(booking.pickupDate) : '—')} ${escapeHtml(booking.pickupTime || '')}`, html: true },
        { label: 'Vehicle', value: booking.selectedCar || booking.vehicleId || '—' },
        { label: 'Status', value: renderBadge(booking.bookingStatus || '—'), html: true },
        { label: 'Payment', value: renderBadge(booking.paymentStatus || '—'), html: true },
        { label: 'Driver', value: booking.assignedDriver?.driverName || '—' },
        { label: 'Invoice', value: booking.invoiceId || booking.invoice?.invoiceId || '—' },
        { label: 'Fare', value: fmtMoney(booking.totalFare || booking.estimatedFare || 0) }
      ],
      actions: `
        <div class="booking-actions-cluster">
          <div class="booking-actions-primary">
            <button class="small-btn gold" data-action="booking-status" data-id="${booking._id}" data-status="Approved">Approve</button>
            <button class="small-btn gold" data-action="booking-assign" data-id="${booking._id}">Assign</button>
            <button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Started">Start</button>
            <button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Completed">Complete</button>
          </div>
          <details class="booking-more-menu">
            <summary class="small-btn booking-more-trigger" aria-label="More booking actions">
              <i class="fa-solid fa-ellipsis-vertical"></i>
              <span>More</span>
            </summary>
            <div class="booking-more-panel">
              <button class="small-btn primary" data-action="booking-edit-invoice" data-id="${booking._id}">Invoice editor</button>
              ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-regenerate-invoice" data-id="${booking._id}">Regenerate</button>` : ''}
              ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn gold" data-action="booking-send-invoice" data-id="${booking._id}">Resend</button>` : ''}
              <button class="small-btn gold" data-action="booking-mark-paid" data-id="${booking._id}">Mark paid</button>
              <button class="small-btn danger" data-action="booking-reject" data-id="${booking._id}">Reject</button>
              ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-download-invoice" data-id="${booking._id}">Download invoice</button>` : ''}
              <button class="small-btn danger" data-action="booking-delete" data-id="${booking._id}">Delete</button>
            </div>
          </details>
        </div>
      `
    })).join('');
    const rows = bookings.map((booking) => `
      <tr class="booking-row">
        <td data-label="Booking">
          <strong>${escapeHtml(booking.bookingId)}</strong>
          <div class="helper">${escapeHtml(fmtDateTime(booking.createdAt))}</div>
        </td>
        <td data-label="Customer">
          ${escapeHtml(booking.customerName)}
          <div class="helper">${escapeHtml(booking.email || '')}<br>${escapeHtml(booking.phone || '')}</div>
        </td>
        <td data-label="Route">
          ${escapeHtml(booking.pickupLocation)} → ${escapeHtml(booking.dropLocation)}
          <div class="helper">${escapeHtml(booking.pickupDate ? fmtDate(booking.pickupDate) : '')} ${escapeHtml(booking.pickupTime || '')}</div>
        </td>
        <td data-label="Vehicle">
          ${escapeHtml(booking.selectedCar || '')}
          <div class="helper">${escapeHtml(booking.selectedPackage || '')}</div>
        </td>
        <td data-label="Status">
          ${renderBadge(booking.bookingStatus)}
          <div class="helper">${renderBadge(booking.paymentStatus)}</div>
        </td>
        <td data-label="Payment">
          ${fmtMoney(booking.totalFare || booking.estimatedFare)}
          <div class="helper">Invoice: ${escapeHtml(booking.invoiceId || booking.invoice?.invoiceId || '—')}<br>Payment: ${renderBadge(booking.paymentStatus)}</div>
        </td>
        <td data-label="Driver">${booking.assignedDriver?.driverName ? escapeHtml(booking.assignedDriver.driverName) : '—'}</td>
        <td data-label="Actions">
          <div class="booking-actions-cluster">
            <div class="booking-actions-primary">
              <button class="small-btn gold" data-action="booking-status" data-id="${booking._id}" data-status="Approved">Approve</button>
              <button class="small-btn gold" data-action="booking-assign" data-id="${booking._id}">Assign</button>
              <button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Started">Start</button>
              <button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Completed">Complete</button>
            </div>
            <details class="booking-more-menu">
              <summary class="small-btn booking-more-trigger" aria-label="More booking actions">
                <i class="fa-solid fa-ellipsis-vertical"></i>
                <span>More</span>
              </summary>
              <div class="booking-more-panel">
                <button class="small-btn primary" data-action="booking-edit-invoice" data-id="${booking._id}">Invoice editor</button>
                ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-regenerate-invoice" data-id="${booking._id}">Regenerate</button>` : ''}
                ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn gold" data-action="booking-send-invoice" data-id="${booking._id}">Resend</button>` : ''}
                <button class="small-btn gold" data-action="booking-mark-paid" data-id="${booking._id}">Mark paid</button>
                <button class="small-btn danger" data-action="booking-reject" data-id="${booking._id}">Reject</button>
                ${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-download-invoice" data-id="${booking._id}">Download invoice</button>` : ''}
                <button class="small-btn danger" data-action="booking-delete" data-id="${booking._id}">Delete</button>
              </div>
            </details>
          </div>
        </td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view booking-view">
        <section class="card booking-toolbar-container">
          <div class="booking-page-head">
            <div>
              <h3>Booking Management</h3>
              <p>Approvals, driver assignment, invoice actions, and ride status in one compact workspace.</p>
            </div>
            <span class="booking-count-chip">${bookings.length} booking${bookings.length === 1 ? '' : 's'}</span>
          </div>
          ${getBookingToolbarMarkup()}
        </section>

        <section class="card table-card booking-table-card">
          ${tableShell(['Booking', 'Customer', 'Route', 'Vehicle', 'Status', 'Payment', 'Driver', 'Actions'], rows, 'No bookings found', cards)}
        </section>
      </div>
    `;
  }

  function renderDriversView() {
    const drivers = state.drivers || [];
    const cards = drivers.map((driver) => renderTableCard({
      title: driver.driverName || '—',
      subtitle: driver.currentLocation || 'No location set',
      fields: [
        { label: 'Phone', value: driver.phone || '—' },
        { label: 'License', value: driver.licenseNumber || '—' },
        { label: 'Assigned vehicle', value: driver.vehicleAssigned || '—' },
        { label: 'Availability', value: renderBadge(driver.availability ? 'Available' : 'Busy'), html: true }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-entity-edit="driver" data-id="${driver._id}">Edit</button>`,
        `<button class="small-btn danger" data-entity-delete="driver" data-id="${driver._id}">Delete</button>`
      ])
    })).join('');
    const rows = drivers.map((driver) => `
      <tr>
        <td><strong>${escapeHtml(driver.driverName)}</strong><div class="helper">${escapeHtml(driver.currentLocation || '')}</div></td>
        <td>${escapeHtml(driver.phone)}</td>
        <td>${escapeHtml(driver.licenseNumber)}</td>
        <td>${escapeHtml(driver.vehicleAssigned || '—')}</td>
        <td>${renderBadge(driver.availability ? 'Available' : 'Busy')}</td>
        <td>
          ${renderButtons([
            `<button class="small-btn primary" data-entity-edit="driver" data-id="${driver._id}">Edit</button>`,
            `<button class="small-btn danger" data-entity-delete="driver" data-id="${driver._id}">Delete</button>`
          ])}
        </td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card">
          <div class="card-header"><div><h3>Driver management</h3><p>Add, edit, assign vehicles, and track availability</p></div><button class="primary-btn" data-open-form="driver">Add driver</button></div>
          <div class="helper">Use the add button to open the driver form. Edit from the table.</div>
        </section>
        <section class="card table-card">
          ${tableShell(['Driver', 'Phone', 'License', 'Assigned vehicle', 'Availability', 'Actions'], rows, 'No drivers found', cards)}
        </section>
      </div>
    `;
  }

  function renderCarsView() {
    const cars = state.cars || [];
    const cards = cars.map((car) => renderTableCard({
      title: car.carName || '—',
      subtitle: car.category || 'Fleet vehicle',
      badges: [renderBadge(car.availability ? 'Available' : 'Unavailable')],
      fields: [
        { label: 'Seats', value: String(car.seatingCapacity || '—') },
        { label: 'Fuel', value: car.fuelType || '—' },
        { label: 'Transmission', value: car.transmission || '—' },
        { label: 'Base fare', value: fmtMoney(car.baseFare || car.pricePerDay || 0) },
        { label: 'Price / km', value: fmtMoney(car.pricePerKm || 0) },
        { label: 'Included km', value: `${String(car.includedKm || 0)} km` },
        { label: 'Extra / km', value: fmtMoney(car.extraKmRate || 0) },
        { label: 'Features', value: (car.features || []).join(', ') || '—' }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-entity-edit="car" data-id="${car._id}">Edit</button>`,
        `<button class="small-btn danger" data-entity-delete="car" data-id="${car._id}">Delete</button>`
      ])
    })).join('');
    const rows = cars.map((car) => `
      <tr>
        <td>
          <strong>${escapeHtml(car.carName)}</strong>
          <div class="helper">${escapeHtml(car.category || '')}</div>
          ${renderImageThumb(car.image, car.carName)}
        </td>
        <td>${escapeHtml(String(car.seatingCapacity || ''))}</td>
        <td>${escapeHtml(car.fuelType || '')}<div class="helper">${escapeHtml(car.transmission || '')}</div></td>
        <td>${fmtMoney(car.baseFare || car.pricePerDay)}</td>
        <td>${fmtMoney(car.pricePerKm || 0)}</td>
        <td>${renderBadge(car.availability ? 'Available' : 'Unavailable')}</td>
        <td>${escapeHtml(String(car.includedKm || 0))} km<div class="helper">Extra: ${fmtMoney(car.extraKmRate || 0)}/km</div></td>
        <td>${(car.features || []).map((feature) => `<span class="badge">${escapeHtml(feature)}</span>`).join(' ') || '—'}</td>
        <td>
          ${renderButtons([
            `<button class="small-btn primary" data-entity-edit="car" data-id="${car._id}">Edit</button>`,
            `<button class="small-btn danger" data-entity-delete="car" data-id="${car._id}">Delete</button>`
          ])}
        </td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card">
          <div class="card-header"><div><h3>Fleet management</h3><p>Maintain vehicle images, pricing, and features</p></div><button class="primary-btn" data-open-form="car">Add car</button></div>
          <div class="helper">Cars support direct image URLs and feature lists separated by commas or new lines.</div>
        </section>
        <section class="card table-card">
          ${tableShell(['Car', 'Seats', 'Fuel', 'Base fare', 'Price/km', 'Availability', 'Included km', 'Features', 'Actions'], rows, 'No cars found', cards)}
        </section>
      </div>
    `;
  }

  function renderPackagesView() {
    const packages = state.packages || [];
    const cards = packages.map((item) => renderTableCard({
      title: item.packageName || '—',
      subtitle: item.duration || 'Package',
      fields: [
        { label: 'Price', value: fmtMoney(item.price || 0) },
        { label: 'Destinations', value: (item.destinations || []).join(', ') || '—' },
        { label: 'Description', value: item.description || '—' }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-entity-edit="package" data-id="${item._id}">Edit</button>`,
        `<button class="small-btn danger" data-entity-delete="package" data-id="${item._id}">Delete</button>`
      ])
    })).join('');
    const rows = packages.map((item) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.packageName)}</strong>
          <div class="helper">${escapeHtml(item.duration || '')}</div>
          ${renderImageThumb(item.image, item.packageName)}
        </td>
        <td>${fmtMoney(item.price)}</td>
        <td>${(item.destinations || []).map((value) => `<span class="badge">${escapeHtml(value)}</span>`).join(' ') || '—'}</td>
        <td>${escapeHtml(item.description || '')}</td>
        <td>${renderButtons([
          `<button class="small-btn primary" data-entity-edit="package" data-id="${item._id}">Edit</button>`,
          `<button class="small-btn danger" data-entity-delete="package" data-id="${item._id}">Delete</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card">
          <div class="card-header"><div><h3>Tour packages</h3><p>Manage destinations, pricing, and inclusions</p></div><button class="primary-btn" data-open-form="package">Add package</button></div>
          <div class="helper">Destination, inclusion, and exclusion lists accept comma or line-separated values. Package artwork is managed by image URL.</div>
        </section>
        <section class="card table-card">
          ${tableShell(['Package', 'Price', 'Destinations', 'Description', 'Actions'], rows, 'No packages found', cards)}
        </section>
      </div>
    `;
  }

  function renderRoutesView() {
    const routes = state.routes || [];
    const cards = routes.map((item) => renderTableCard({
      title: `${item.from || '—'} → ${item.to || '—'}`,
      subtitle: item.estimatedTime || 'Route pricing',
      fields: [
        { label: 'Distance', value: item.distance || '—' },
        { label: 'Price', value: fmtMoney(item.price || 0) }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-entity-edit="route" data-id="${item._id}">Edit</button>`,
        `<button class="small-btn danger" data-entity-delete="route" data-id="${item._id}">Delete</button>`
      ])
    })).join('');
    const rows = routes.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.from)}</strong></td>
        <td><strong>${escapeHtml(item.to)}</strong></td>
        <td>${escapeHtml(item.distance || '—')}</td>
        <td>${escapeHtml(item.estimatedTime || '—')}</td>
        <td>${fmtMoney(item.price)}</td>
        <td>${renderButtons([
          `<button class="small-btn primary" data-entity-edit="route" data-id="${item._id}">Edit</button>`,
          `<button class="small-btn danger" data-entity-delete="route" data-id="${item._id}">Delete</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card">
          <div class="card-header"><div><h3>Route pricing</h3><p>Update route fares and travel estimates</p></div><button class="primary-btn" data-open-form="route">Add route</button></div>
        </section>
        <section class="card table-card">
          ${tableShell(['From', 'To', 'Distance', 'Time', 'Price', 'Actions'], rows, 'No routes found', cards)}
        </section>
      </div>
    `;
  }

  function renderCustomersView() {
    const customers = state.customers || [];
    const cards = customers.map((customer) => renderTableCard({
      title: customer.name || '—',
      subtitle: customer.email || 'Customer',
      badges: [renderBadge(customer.isBlocked ? 'Blocked' : 'Active')],
      fields: [
        { label: 'Phone', value: customer.phone || '—' },
        { label: 'Joined', value: fmtDateTime(customer.createdAt) }
      ],
      actions: renderButtons([
        `<button class="small-btn ${customer.isBlocked ? 'gold' : 'primary'}" data-customer-block="${customer._id}" data-blocked="${customer.isBlocked ? 'false' : 'true'}">${customer.isBlocked ? 'Unblock' : 'Block'}</button>`,
        `<button class="small-btn danger" data-customer-delete="${customer._id}">Delete</button>`
      ])
    })).join('');
    const rows = customers.map((customer) => `
      <tr>
        <td><strong>${escapeHtml(customer.name)}</strong><div class="helper">${escapeHtml(customer.email || '')}</div></td>
        <td>${escapeHtml(customer.phone || '')}</td>
        <td>${renderBadge(customer.isBlocked ? 'Blocked' : 'Active')}</td>
        <td>${escapeHtml(fmtDateTime(customer.createdAt))}</td>
        <td>${renderButtons([
          `<button class="small-btn ${customer.isBlocked ? 'gold' : 'primary'}" data-customer-block="${customer._id}" data-blocked="${customer.isBlocked ? 'false' : 'true'}">${customer.isBlocked ? 'Unblock' : 'Block'}</button>`,
          `<button class="small-btn danger" data-customer-delete="${customer._id}">Delete</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card table-card">
          ${tableShell(['Customer', 'Phone', 'Status', 'Joined', 'Actions'], rows, 'No customers found', cards)}
        </section>
      </div>
    `;
  }

  function renderPaymentsView() {
    const payments = state.payments || [];
    const cards = payments.map((payment) => renderTableCard({
      title: payment.booking?.bookingId || payment.metadata?.bookingId || payment._id || 'Payment',
      subtitle: payment.provider || 'Settlement',
      badges: [renderBadge(payment.status || 'Pending')],
      fields: [
        { label: 'Amount', value: fmtMoney(payment.amount || 0) },
        { label: 'Type', value: payment.paymentType || '—' },
        { label: 'Created', value: fmtDateTime(payment.createdAt) }
      ],
      actions: renderButtons([
        `<button class="small-btn gold" data-payment-refund="${payment._id}">Refund</button>`
      ])
    })).join('');
    const rows = payments.map((payment) => `
      <tr>
        <td><strong>${escapeHtml(payment.booking?.bookingId || payment.metadata?.bookingId || payment._id)}</strong></td>
        <td>${fmtMoney(payment.amount)}</td>
        <td>${escapeHtml(payment.paymentType || '')}</td>
        <td>${renderBadge(payment.status || '')}</td>
        <td>${escapeHtml(payment.provider || '')}</td>
        <td>${escapeHtml(fmtDateTime(payment.createdAt))}</td>
        <td>${renderButtons([
          `<button class="small-btn gold" data-payment-refund="${payment._id}">Refund</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card table-card">
          ${tableShell(['Booking', 'Amount', 'Type', 'Status', 'Provider', 'Created', 'Actions'], rows, 'No payments found', cards)}
        </section>
      </div>
    `;
  }

  function renderInvoicesView() {
    const invoices = state.invoices || [];
    const cards = invoices.map((invoice) => {
      const bookingId = invoice.booking?._id || invoice.booking;
      return renderTableCard({
        title: invoice.invoiceId || '—',
        subtitle: invoice.customerName || 'Invoice',
        fields: [
          { label: 'Booking', value: invoice.bookingId || '—' },
          { label: 'Amount', value: fmtMoney(invoice.totalFare || 0) },
          { label: 'Status', value: renderBadge(invoice.paymentStatus || 'Pending'), html: true },
          { label: 'Created', value: fmtDateTime(invoice.createdAt) }
        ],
        actions: bookingId ? renderButtons([
          `<button class="small-btn primary" data-action="booking-edit-invoice" data-id="${bookingId}">Edit</button>`,
          `<button class="small-btn" data-action="booking-download-invoice" data-id="${bookingId}">Download</button>`,
          `<button class="small-btn gold" data-action="booking-send-invoice" data-id="${bookingId}">Resend</button>`,
          `<button class="small-btn primary" data-action="booking-regenerate-invoice" data-id="${bookingId}">Regenerate</button>`
        ]) : '<span class="helper">Booking not linked</span>'
      });
    }).join('');
    const rows = invoices.map((invoice) => {
      const bookingId = invoice.booking?._id || invoice.booking;
      return `
      <tr>
        <td><strong>${escapeHtml(invoice.invoiceId || '—')}</strong><div class="helper">${escapeHtml(invoice.bookingId || '—')}</div></td>
        <td>${escapeHtml(invoice.customerName || '—')}<div class="helper">${escapeHtml(invoice.email || '')}</div></td>
        <td>${fmtMoney(invoice.totalFare || 0)}</td>
        <td>${renderBadge(invoice.paymentStatus || 'Pending')}</td>
        <td>${escapeHtml(fmtDateTime(invoice.createdAt))}</td>
        <td>
          ${bookingId ? renderButtons([
            `<button class="small-btn primary" data-action="booking-edit-invoice" data-id="${bookingId}">Edit</button>`,
            `<button class="small-btn" data-action="booking-download-invoice" data-id="${bookingId}">Download</button>`,
            `<button class="small-btn gold" data-action="booking-send-invoice" data-id="${bookingId}">Resend</button>`,
            `<button class="small-btn primary" data-action="booking-regenerate-invoice" data-id="${bookingId}">Regenerate</button>`
          ]) : '<span class="helper">Booking not linked</span>'}
        </td>
      </tr>
    `;
    }).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card table-card">
          ${tableShell(['Invoice', 'Customer', 'Amount', 'Status', 'Created', 'Actions'], rows, 'No invoices found', cards)}
        </section>
      </div>
    `;
  }

  function renderMessagesView() {
    const messages = state.messages || [];
    const cards = messages.map((message) => renderTableCard({
      title: message.name || '—',
      subtitle: message.subject || 'General inquiry',
      badges: [renderBadge(message.status || 'open')],
      fields: [
        { label: 'Email', value: message.email || '—' },
        { label: 'Phone', value: message.phone || '—' },
        { label: 'Message', value: message.message || '—', full: true },
        { label: 'Received', value: fmtDateTime(message.createdAt) }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-message-reply="${message._id}">Reply</button>`,
        `<button class="small-btn gold" data-message-resolve="${message._id}">Resolve</button>`,
        `<button class="small-btn danger" data-message-delete="${message._id}">Delete</button>`
      ])
    })).join('');
    const rows = messages.map((message) => `
      <tr>
        <td><strong>${escapeHtml(message.name)}</strong><div class="helper">${escapeHtml(message.email || '')}<br>${escapeHtml(message.phone || '')}</div></td>
        <td>${escapeHtml(message.subject || 'General')}</td>
        <td>${escapeHtml(message.message || '')}</td>
        <td>${renderBadge(message.status || 'open')}</td>
        <td>${escapeHtml(fmtDateTime(message.createdAt))}</td>
        <td>${renderButtons([
          `<button class="small-btn primary" data-message-reply="${message._id}">Reply</button>`,
          `<button class="small-btn gold" data-message-resolve="${message._id}">Resolve</button>`,
          `<button class="small-btn danger" data-message-delete="${message._id}">Delete</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card table-card">
          ${tableShell(['Sender', 'Subject', 'Message', 'Status', 'Received', 'Actions'], rows, 'No messages found', cards)}
        </section>
      </div>
    `;
  }

  function renderContentView() {
    const settings = state.settings || {};
    const homepage = settings.homepage || {};
    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card">
          <div class="card-header"><div><h3>Website content</h3><p>Edit homepage, branding, SEO, and banner image</p></div><button class="primary-btn" id="saveContentBtn" type="button">Save content</button></div>
          <div class="form-grid" id="contentForm">
            <label class="field wide"><span>Business name</span><input name="businessName" value="${escapeHtml(settings.businessName || '')}" /></label>
            <label class="field wide"><span>Logo text</span><input name="logoText" value="${escapeHtml(settings.logoText || '')}" /></label>
            <label class="field wide"><span>Contact email</span><input name="contactEmail" value="${escapeHtml(settings.contactEmail || '')}" /></label>
            <label class="field wide"><span>Contact phone</span><input name="contactPhone" value="${escapeHtml(settings.contactPhone || '')}" /></label>
            <label class="field full"><span>Address</span><input name="address" value="${escapeHtml(settings.address || '')}" /></label>
            <label class="field full"><span>Hero title</span><input name="heroTitle" value="${escapeHtml(homepage.heroTitle || '')}" /></label>
            <label class="field full"><span>Hero subtitle</span><textarea name="heroSubtitle">${escapeHtml(homepage.heroSubtitle || '')}</textarea></label>
            <label class="field wide"><span>SEO title</span><input name="seoTitle" value="${escapeHtml(homepage.seoTitle || '')}" /></label>
            <label class="field wide"><span>SEO description</span><input name="seoDescription" value="${escapeHtml(homepage.seoDescription || '')}" /></label>
            <label class="field wide"><span>Website link</span><input name="website" value="${escapeHtml(settings.socialLinks?.website || '')}" /></label>
            <label class="field wide"><span>Facebook</span><input name="facebook" value="${escapeHtml(settings.socialLinks?.facebook || '')}" /></label>
            <label class="field wide"><span>Instagram</span><input name="instagram" value="${escapeHtml(settings.socialLinks?.instagram || '')}" /></label>
            <label class="field wide"><span>WhatsApp</span><input name="whatsapp" value="${escapeHtml(settings.socialLinks?.whatsapp || '')}" /></label>
            ${renderImageUrlField({
              name: 'bannerImage',
              label: 'Banner image URL',
              value: homepage.bannerImage || '',
              alt: 'Homepage banner preview',
              previewId: 'bannerImagePreview',
              statusId: 'bannerImageStatus',
              helper: 'Paste a direct JPG, PNG, JPEG, or WEBP image URL for the homepage banner.'
            })}
            <label class="field wide"><span>Currency</span><input name="currency" value="${escapeHtml(settings.paymentSettings?.currency || 'INR')}" /></label>
            <label class="field wide"><span>Advance percent</span><input name="advancePercent" type="number" value="${escapeHtml(String(settings.paymentSettings?.advancePercent ?? 20))}" /></label>
            <label class="field wide"><span>Payment gateway</span><input name="gatewayName" value="${escapeHtml(settings.paymentSettings?.gatewayName || 'Stripe')}" /></label>
            <div class="section-subtle"><strong>Pricing settings</strong><p class="muted">Configure package inclusions, per-km rates, surge, and night/driver allowances. Changes affect fare calculations immediately.</p></div>
            <label class="field wide"><span>GST %</span><input name="gstPercent" type="number" value="${escapeHtml(String(settings.pricingSettings?.gstPercent ?? settings.billing?.taxPercent ?? 5))}" /><small class="field-help">GST applied to the subtotal (percentage).</small></label>
            <label class="field wide"><span>Night charge % (applied on distance fare)</span><input name="nightChargePercent" type="number" value="${escapeHtml(String(settings.pricingSettings?.nightChargePercent ?? 10))}" /><small class="field-help">Percentage of distance charges applied for night pickups (22:00–06:00).</small></label>
            <label class="field wide"><span>Local package price</span><input name="localPackagePrice" type="number" value="${escapeHtml(String(settings.pricingSettings?.localPackagePrice ?? settings.pricingSettings?.baseFare ?? 6500))}" /></label>
            <label class="field wide"><span>Half day package price</span><input name="halfDayPrice" type="number" value="${escapeHtml(String(settings.pricingSettings?.halfDayPrice ?? 3500))}" /></label>
            <label class="field wide"><span>Extra KM charge</span><input name="extraKmCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.extraKmCharge ?? settings.pricingSettings?.extraKmRate ?? 28))}" /></label>
            <label class="field wide"><span>Extra hour charge</span><input name="extraHourCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.extraHourCharge ?? 500))}" /></label>
            <label class="field wide"><span>Airport pickup / drop min</span><input name="airportTransferMinCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.airportTransferMinCharge ?? 2500))}" /></label>
            <label class="field wide"><span>Airport pickup / drop max</span><input name="airportTransferMaxCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.airportTransferMaxCharge ?? 3500))}" /></label>
            <label class="field wide"><span>Outstation min</span><input name="outstationMinCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.outstationMinCharge ?? 8500))}" /></label>
            <label class="field wide"><span>Outstation max</span><input name="outstationMaxCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.outstationMaxCharge ?? 10500))}" /></label>
            <label class="field wide"><span>Wedding / VIP price</span><input name="weddingVipCharge" type="number" value="${escapeHtml(String(settings.pricingSettings?.weddingVipCharge ?? 12000))}" /></label>
            <label class="field wide"><span>Driver allowance (legacy)</span><input name="driverAllowance" type="number" value="${escapeHtml(String(settings.pricingSettings?.driverAllowance ?? 0))}" /><small class="field-help">Legacy single-value driver allowance; prefer per-day value below.</small></label>
            <label class="field wide"><span>Driver allowance / day</span><input name="driverAllowancePerDay" type="number" value="${escapeHtml(String(settings.pricingSettings?.driverAllowancePerDay ?? settings.pricingSettings?.driverAllowance ?? 0))}" /><small class="field-help">Per-day driver allowance used for outstation and multi-day trips (1 day for same-day trips).</small></label>
            <label class="field wide"><span>Waiting charge / hour</span><input name="waitingChargePerHour" type="number" value="${escapeHtml(String(settings.pricingSettings?.waitingChargePerHour ?? 0))}" /></label>
            <label class="field wide"><span>Default included km</span><input name="defaultIncludedKm" type="number" value="${escapeHtml(String(settings.pricingSettings?.defaultIncludedKm ?? 0))}" /></label>
            <label class="field wide"><span>Default included hours</span><input name="defaultIncludedHours" type="number" value="${escapeHtml(String(settings.pricingSettings?.defaultIncludedHours ?? 8))}" /></label>
            <label class="field wide"><span>Default base fare</span><input name="defaultBaseFare" type="number" value="${escapeHtml(String(settings.pricingSettings?.baseFare ?? settings.pricingSettings?.localPackagePrice ?? 6500))}" /></label>
            <label class="field wide"><span>Default price per km</span><input name="defaultPricePerKm" type="number" value="${escapeHtml(String(settings.pricingSettings?.pricePerKm ?? settings.pricingSettings?.extraKmCharge ?? 28))}" /><small class="field-help">Default per-km rate used for outstation and non-package calculations.</small></label>
            <label class="field wide"><span>Minimum fare</span><input name="minimumFare" type="number" value="${escapeHtml(String(settings.pricingSettings?.minimumFare ?? 0))}" /><small class="field-help">If subtotal &lt; minimum fare, the minimum will be charged instead.</small></label>
            <label class="field wide"><span>Surge multiplier</span><input name="surgeMultiplier" type="number" step="0.01" value="${escapeHtml(String(settings.pricingSettings?.surgeMultiplier ?? 1))}" /><small class="field-help">Global multiplier applied to distance charges (e.g., 1.2 = 20% surge). You can set festival/peak/weekend multipliers here.</small></label>
            <label class="field wide"><span>Night charge fixed (optional)</span><input name="nightChargeFixed" type="number" value="${escapeHtml(String(settings.pricingSettings?.nightChargeFixed ?? 0))}" /><small class="field-help">Optional fixed night fee; if set it overrides percentage-based night charge calculation.</small></label>
            <label class="field full"><span>Testimonials (Name::Quote per line)</span><textarea name="testimonials">${escapeHtml((homepage.testimonials || []).map((item) => `${item.name}::${item.quote}`).join('\n'))}</textarea></label>
            <label class="field full"><span>Fleet highlights (Title::Description per line)</span><textarea name="fleetHighlights">${escapeHtml((homepage.fleetHighlights || []).map((item) => `${item.title}::${item.description}`).join('\n'))}</textarea></label>
            <label class="inline-toggle"><input type="checkbox" name="emailEnabled" ${settings.notificationSettings?.emailEnabled !== false ? 'checked' : ''} /><span>Email notifications enabled</span></label>
            <label class="inline-toggle"><input type="checkbox" name="whatsappEnabled" ${settings.notificationSettings?.whatsappEnabled !== false ? 'checked' : ''} /><span>WhatsApp notifications enabled</span></label>
            <label class="inline-toggle"><input type="checkbox" name="realtimeEnabled" ${settings.notificationSettings?.realtimeEnabled !== false ? 'checked' : ''} /><span>Realtime updates enabled</span></label>
          </div>
        </section>
      </div>
    `;
  }

  function renderAnalyticsView() {
    const dashboard = state.dashboard;
    if (!dashboard) {
      el.viewRoot.innerHTML = '<div class="loading-state">Loading analytics...</div>';
      return;
    }
    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="section-grid">
          <article class="card chart-card">
            <div class="card-header"><div><h3>Customer growth</h3><p>Monthly new customer signups</p></div></div>
            <div class="chart-box"><canvas id="customerChart"></canvas></div>
          </article>
          <article class="card chart-card">
            <div class="card-header"><div><h3>Revenue trend</h3><p>Completed payment totals</p></div></div>
            <div class="chart-box"><canvas id="analyticsRevenueChart"></canvas></div>
          </article>
        </section>
      </div>
    `;
    ensureChart('customerChart', {
      type: 'bar',
      data: {
        labels: chartLabels(dashboard.charts?.customerGrowth || []),
        datasets: [{ label: 'Customers', data: chartValues(dashboard.charts?.customerGrowth || []), backgroundColor: 'rgba(106,27,154,0.74)', borderRadius: 10, borderSkipped: false }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#4a2a63' }, grid: { color: 'rgba(106,27,154,0.10)' } }, x: { ticks: { color: '#4a2a63' }, grid: { display: false } } } }
    });
    ensureChart('analyticsRevenueChart', {
      type: 'line',
      data: {
        labels: chartLabels(dashboard.charts?.monthlyRevenue || []),
        datasets: [{ label: 'Revenue', data: chartValues(dashboard.charts?.monthlyRevenue || []), borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.16)', tension: 0.36, fill: true, pointBackgroundColor: '#6A1B9A', pointBorderColor: '#ffffff' }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#4a2a63' }, grid: { color: 'rgba(106,27,154,0.10)' } }, x: { ticks: { color: '#4a2a63' }, grid: { display: false } } } }
    });
  }

  function renderNotificationsView() {
    const notifications = state.notifications || [];
    const cards = notifications.map((item) => renderTableCard({
      title: item.title || item.type || 'Notification',
      subtitle: item.message || 'System alert',
      badges: [renderBadge(item.readAt ? 'Read' : 'Unread')],
      fields: [
        { label: 'Customer', value: getNotificationSummary(item).customerName },
        { label: 'Ride', value: getNotificationSummary(item).rideType },
        { label: 'Booking', value: item.bookingId || item.metadata?.bookingId || '—' },
        { label: 'State', value: getNotificationSummary(item).bookingStatus || 'Pending' },
        { label: 'Created', value: fmtDateTime(item.createdAt) }
      ],
      actions: renderButtons([
        `<button class="small-btn primary" data-notification-read="${item._id}">Mark read</button>`,
        `<button class="small-btn danger" data-notification-delete="${item._id}">Delete</button>`
      ])
    })).join('');
    const rows = notifications.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.title || item.type || '')}</strong><div class="helper">${escapeHtml(item.type || '')}</div></td>
        <td>${escapeHtml(item.message || '')}</td>
        <td>${escapeHtml(getNotificationSummary(item).customerName)}<div class="helper">${escapeHtml(getNotificationSummary(item).rideType)}${getNotificationSummary(item).vehicle ? ` · ${escapeHtml(getNotificationSummary(item).vehicle)}` : ''}</div></td>
        <td>${escapeHtml(item.bookingId || item.metadata?.bookingId || '—')}<div class="helper">${escapeHtml(getNotificationSummary(item).bookingStatus || 'Pending')}</div></td>
        <td>${renderBadge(item.readAt ? 'Read' : 'Unread')}</td>
        <td>${escapeHtml(fmtDateTime(item.createdAt))}</td>
        <td>${renderButtons([
          `<button class="small-btn primary" data-notification-read="${item._id}">Mark read</button>`,
          `<button class="small-btn danger" data-notification-delete="${item._id}">Delete</button>`
        ])}</td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view">
        <section class="card table-card">
          ${tableShell(['Title', 'Message', 'Customer', 'Booking', 'State', 'Created', 'Actions'], rows, 'No notifications found', cards)}
        </section>
      </div>
    `;
  }

  function renderCurrentView() {
    renderTopbarSurface();
    if (state.view === 'dashboard') renderDashboard();
    else if (state.view === 'bookings') renderBookingsView();
    else if (state.view === 'drivers') renderDriversView();
    else if (state.view === 'cars') renderCarsView();
    else if (state.view === 'packages') renderPackagesView();
    else if (state.view === 'routes') renderRoutesView();
    else if (state.view === 'customers') renderCustomersView();
    else if (state.view === 'payments') renderPaymentsView();
    else if (state.view === 'invoices') renderInvoicesView();
    else if (state.view === 'messages') renderMessagesView();
    else if (state.view === 'content') renderContentView();
    else if (state.view === 'analytics') renderAnalyticsView();
    else if (state.view === 'settings') renderContentView();
    else if (state.view === 'notifications') renderNotificationsView();
  }

  function resetCaches(except = null) {
    const keys = ['dashboard', 'bookings', 'drivers', 'cars', 'packages', 'routes', 'customers', 'payments', 'invoices', 'messages', 'settings', 'notifications'];
    keys.forEach((key) => {
      if (key !== except) state[key] = null;
    });
  }

  async function refreshView() {
    try {
      if (state.view === 'dashboard' || state.view === 'analytics') {
        await loadDashboard();
        if (state.view === 'analytics') renderAnalyticsView();
      } else if (state.view === 'bookings') {
        await loadBookings(true);
        renderBookingsView();
      } else if (state.view === 'drivers') {
        await loadDrivers(true);
        renderDriversView();
      } else if (state.view === 'cars') {
        await loadCars(true);
        renderCarsView();
      } else if (state.view === 'packages') {
        await loadPackages(true);
        renderPackagesView();
      } else if (state.view === 'routes') {
        await loadRoutes(true);
        renderRoutesView();
      } else if (state.view === 'customers') {
        await loadCustomers(true);
        renderCustomersView();
      } else if (state.view === 'payments') {
        await loadPayments(true);
        renderPaymentsView();
      } else if (state.view === 'invoices') {
        await loadInvoices(true);
        renderInvoicesView();
      } else if (state.view === 'messages') {
        await loadMessages(true);
        renderMessagesView();
      } else if (state.view === 'content' || state.view === 'settings') {
        await loadSettings(true);
        renderContentView();
      } else if (state.view === 'notifications') {
        await loadNotifications(true);
        renderNotificationsView();
      }
    } catch (error) {
      toast('Refresh failed', error.message, 'error');
    }
  }

  function openForm(entity, record = null) {
    const configs = {
      driver: {
        title: record ? 'Edit driver' : 'Add driver',
        eyebrow: 'Driver form',
        fields: `
          <form class="auth-form" data-save-entity="driver">
            <div class="form-grid">
              <label class="field wide"><span>Name</span><input name="driverName" value="${escapeHtml(record?.driverName || '')}" required /></label>
              <label class="field wide"><span>Phone</span><input name="phone" value="${escapeHtml(record?.phone || '')}" required /></label>
              <label class="field wide"><span>License number</span><input name="licenseNumber" value="${escapeHtml(record?.licenseNumber || '')}" required /></label>
              <label class="field wide"><span>Vehicle assigned</span><input name="vehicleAssigned" value="${escapeHtml(record?.vehicleAssigned || '')}" /></label>
              <label class="field wide"><span>Current location</span><input name="currentLocation" value="${escapeHtml(record?.currentLocation || '')}" /></label>
              <label class="inline-toggle"><input type="checkbox" name="availability" ${record?.availability !== false ? 'checked' : ''} /><span>Available</span></label>
            </div>
            <input type="hidden" name="id" value="${escapeHtml(record?._id || '')}" />
            <div class="form-actions"><button class="primary-btn" type="submit">Save driver</button><button class="secondary-btn" type="button" data-close-modal>Cancel</button></div>
          </form>
        `
      },
      car: {
        title: record ? 'Edit car' : 'Add car',
        eyebrow: 'Fleet form',
        fields: `
          <form class="auth-form" data-save-entity="car">
            <div class="form-grid">
              <label class="field wide"><span>Car name</span><input name="carName" value="${escapeHtml(record?.carName || '')}" required /></label>
              <label class="field wide"><span>Seating capacity</span><input type="number" name="seatingCapacity" value="${escapeHtml(String(record?.seatingCapacity || ''))}" required /></label>
              <label class="field wide"><span>Category</span><input name="category" value="${escapeHtml(record?.category || '')}" required /></label>
              <label class="field wide"><span>Fuel type</span><input name="fuelType" value="${escapeHtml(record?.fuelType || '')}" required /></label>
              <label class="field wide"><span>Transmission</span><input name="transmission" value="${escapeHtml(record?.transmission || '')}" required /></label>
              <label class="field wide"><span>Base fare</span><input type="number" name="baseFare" value="${escapeHtml(String(record?.baseFare ?? record?.pricePerDay ?? ''))}" required /></label>
              <label class="field wide"><span>Price per km</span><input type="number" name="pricePerKm" value="${escapeHtml(String(record?.pricePerKm ?? ''))}" required /></label>
              <label class="field wide"><span>Extra km rate</span><input type="number" name="extraKmRate" value="${escapeHtml(String(record?.extraKmRate ?? record?.pricePerKm ?? ''))}" /></label>
              <label class="field wide"><span>Included km</span><input type="number" name="includedKm" value="${escapeHtml(String(record?.includedKm ?? ''))}" /></label>
              <label class="field wide"><span>Night charge %</span><input type="number" name="nightChargePercent" value="${escapeHtml(String(record?.nightChargePercent ?? 10))}" /></label>
              <label class="field wide"><span>Driver allowance</span><input type="number" name="driverAllowance" value="${escapeHtml(String(record?.driverAllowance ?? ''))}" /></label>
              <label class="field full"><span>Features</span><textarea name="features">${escapeHtml((record?.features || []).join(', '))}</textarea></label>
              ${renderImageUrlField({
                name: 'image',
                label: 'Car image URL',
                value: record?.image || '',
                alt: record?.carName || 'Car image preview',
                previewId: 'carImagePreview',
                statusId: 'carImageStatus',
                helper: 'Use a direct image URL. Empty or invalid values show the fallback preview.'
              })}
            </div>
            <input type="hidden" name="id" value="${escapeHtml(record?._id || '')}" />
            <div class="form-actions"><button class="primary-btn" type="submit">Save car</button><button class="secondary-btn" type="button" data-close-modal>Cancel</button></div>
          </form>
        `
      },
      package: {
        title: record ? 'Edit package' : 'Add package',
        eyebrow: 'Package form',
        fields: `
          <form class="auth-form" data-save-entity="package">
            <div class="form-grid">
              <label class="field wide"><span>Package name</span><input name="packageName" value="${escapeHtml(record?.packageName || '')}" required /></label>
              <label class="field wide"><span>Duration</span><input name="duration" value="${escapeHtml(record?.duration || '')}" required /></label>
              <label class="field wide"><span>Price</span><input type="number" name="price" value="${escapeHtml(String(record?.price ?? ''))}" required /></label>
              <label class="field full"><span>Description</span><textarea name="description">${escapeHtml(record?.description || '')}</textarea></label>
              <label class="field full"><span>Destinations</span><textarea name="destinations">${escapeHtml((record?.destinations || []).join(', '))}</textarea></label>
              <label class="field full"><span>Inclusions</span><textarea name="inclusions">${escapeHtml((record?.inclusions || []).join(', '))}</textarea></label>
              <label class="field full"><span>Exclusions</span><textarea name="exclusions">${escapeHtml((record?.exclusions || []).join(', '))}</textarea></label>
              ${renderImageUrlField({
                name: 'image',
                label: 'Package image URL',
                value: record?.image || '',
                alt: record?.packageName || 'Package image preview',
                previewId: 'packageImagePreview',
                statusId: 'packageImageStatus',
                helper: 'Use a direct image URL for the package card or gallery preview.'
              })}
            </div>
            <input type="hidden" name="id" value="${escapeHtml(record?._id || '')}" />
            <div class="form-actions"><button class="primary-btn" type="submit">Save package</button><button class="secondary-btn" type="button" data-close-modal>Cancel</button></div>
          </form>
        `
      },
      route: {
        title: record ? 'Edit route' : 'Add route',
        eyebrow: 'Route form',
        fields: `
          <form class="auth-form" data-save-entity="route">
            <div class="form-grid">
              <label class="field wide"><span>From</span><input name="from" value="${escapeHtml(record?.from || '')}" required /></label>
              <label class="field wide"><span>To</span><input name="to" value="${escapeHtml(record?.to || '')}" required /></label>
              <label class="field wide"><span>Distance</span><input name="distance" value="${escapeHtml(record?.distance || '')}" /></label>
              <label class="field wide"><span>Estimated time</span><input name="estimatedTime" value="${escapeHtml(record?.estimatedTime || '')}" /></label>
              <label class="field wide"><span>Price</span><input type="number" name="price" value="${escapeHtml(String(record?.price ?? ''))}" required /></label>
            </div>
            <input type="hidden" name="id" value="${escapeHtml(record?._id || '')}" />
            <div class="form-actions"><button class="primary-btn" type="submit">Save route</button><button class="secondary-btn" type="button" data-close-modal>Cancel</button></div>
          </form>
        `
      }
    };

    const config = configs[entity];
    if (!config) return;
    openModal(config.title, config.fields, config.eyebrow);
  }

  async function submitEntityForm(form) {
    const entity = form.dataset.saveEntity;
    const id = form.querySelector('[name="id"]')?.value || '';
    const formData = new FormData(form);
    formData.delete('id');

    try {
      let path = '';
      let method = 'POST';
      let payload = formData;

      if (entity === 'driver') {
        path = id ? `/api/admin/drivers/${id}` : '/api/admin/drivers';
        method = id ? 'PUT' : 'POST';
        payload = JSON.stringify({
          driverName: formData.get('driverName'),
          phone: formData.get('phone'),
          licenseNumber: formData.get('licenseNumber'),
          vehicleAssigned: formData.get('vehicleAssigned'),
          currentLocation: formData.get('currentLocation'),
          availability: formData.get('availability') === 'on'
        });
      } else if (entity === 'car') {
        path = id ? `/api/admin/cars/${id}` : '/api/admin/cars';
        method = id ? 'PUT' : 'POST';
        const baseFareValue = formData.get('baseFare');
        const pricePerDayValue = baseFareValue !== null && baseFareValue !== '' ? baseFareValue : formData.get('pricePerDay');
        const carPayload = Object.fromEntries(formData.entries());
        carPayload.pricePerDay = String(pricePerDayValue ?? '0');
        carPayload.image = normalizeImageUrl(carPayload.image);
        payload = JSON.stringify(carPayload);
      } else if (entity === 'package') {
        path = id ? `/api/admin/packages/${id}` : '/api/admin/packages';
        method = id ? 'PUT' : 'POST';
        const packagePayload = Object.fromEntries(formData.entries());
        packagePayload.image = normalizeImageUrl(packagePayload.image);
        payload = JSON.stringify(packagePayload);
      } else if (entity === 'route') {
        path = id ? `/api/admin/routes/${id}` : '/api/admin/routes';
        method = id ? 'PUT' : 'POST';
        payload = JSON.stringify(Object.fromEntries(formData.entries()));
      }

      const body = await apiFetch(path, { method, body: payload });
      if (entity === 'driver') state.drivers = null;
      if (entity === 'car') state.cars = null;
      if (entity === 'package') state.packages = null;
      if (entity === 'route') state.routes = null;
      closeModal();
      toast('Saved', body.message || `${entity} updated`);
      await refreshView();
    } catch (error) {
      toast('Save failed', error.message, 'error');
    }
  }

  async function editEntity(entity, id) {
    try {
      let record;
      if (entity === 'driver') record = (state.drivers || []).find((item) => item._id === id);
      if (entity === 'car') record = (state.cars || []).find((item) => item._id === id);
      if (entity === 'package') record = (state.packages || []).find((item) => item._id === id);
      if (entity === 'route') record = (state.routes || []).find((item) => item._id === id);
      openForm(entity, record);
    } catch (error) {
      toast('Open failed', error.message, 'error');
    }
  }

  async function deleteEntity(entity, id) {
    if (!window.confirm('Delete this record?')) return;
    try {
      const paths = {
        driver: `/api/admin/drivers/${id}`,
        car: `/api/admin/cars/${id}`,
        package: `/api/admin/packages/${id}`,
        route: `/api/admin/routes/${id}`,
        booking: `/api/admin/bookings/${id}`,
        customer: `/api/admin/customers/${id}`,
        message: `/api/admin/messages/${id}`
      };
      await apiFetch(paths[entity], { method: 'DELETE' });
      resetCaches();
      toast('Deleted', `${entity} removed`);
      await refreshView();
    } catch (error) {
      toast('Delete failed', error.message, 'error');
    }
  }

  async function handleTableActions(event) {
    const target = event.target.closest('button');
    if (!target) return;

    const action = target.dataset.action;
    const entity = target.dataset.entityEdit || target.dataset.entityDelete;
    const id = target.dataset.id;

    try {
      if (action === 'booking-status') {
        const status = target.dataset.status;
        await apiFetch(`/api/admin/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        toast('Booking updated', `Status changed to ${status}`);
        state.bookings = null;
        state.dashboard = null;
        await refreshView();
      } else if (action === 'booking-reject') {
        await openWorkflowModal({
          title: 'Reject Booking',
          eyebrow: 'Booking Workflow',
          body: `
            <form data-workflow-form>
              <label class="field full">
                <span>Rejection reason</span>
                <textarea name="reason" rows="4" placeholder="Not available"></textarea>
              </label>
              <div class="form-actions">
                <button class="primary-btn" type="submit">Reject booking</button>
                <button class="secondary-btn" type="button" data-close-modal>Cancel</button>
              </div>
            </form>
          `,
          onSubmit: async (form) => {
            const reason = String(new FormData(form).get('reason') || '').trim();
            await apiFetch(`/api/admin/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Rejected', rejectionReason: reason }) });
            closeModal();
            toast('Booking rejected', 'Reason recorded');
            state.bookings = null;
            await refreshView();
          }
        });
      } else if (action === 'booking-assign') {
        const drivers = await loadDrivers();
        if (!drivers.length) throw new Error('No drivers available');
        const selectedDriverId = drivers.find((driver) => driver.availability)?._id || drivers[0]._id;
        await openWorkflowModal({
          title: 'Assign Driver',
          eyebrow: 'Booking Workflow',
          body: `
            <form data-workflow-form>
              <label class="field full">
                <span>Select driver</span>
                <select name="driverId" required>
                  ${renderDriverOptions(drivers, selectedDriverId)}
                </select>
              </label>
              <div class="form-actions">
                <button class="primary-btn" type="submit">Assign driver</button>
                <button class="secondary-btn" type="button" data-close-modal>Cancel</button>
              </div>
            </form>
          `,
          onSubmit: async (form) => {
            const driverId = String(new FormData(form).get('driverId') || '').trim();
            if (!driverId) throw new Error('Driver selection is required');
            await apiFetch(`/api/admin/bookings/${id}/assign-driver`, { method: 'PATCH', body: JSON.stringify({ driverId }) });
            closeModal();
            toast('Driver assigned', 'Driver linked to booking');
            state.bookings = null;
            await refreshView();
          }
        });
      } else if (action === 'booking-edit-invoice' || action === 'booking-generate-invoice') {
        await openInvoiceEditor(id);
      } else if (action === 'booking-regenerate-invoice') {
        await apiFetch(`/api/admin/bookings/${id}/regenerate-invoice`, { method: 'POST' });
        toast('Invoice regenerated', 'A fresh PDF was created');
        state.bookings = null;
        state.dashboard = null;
        await refreshView();
      } else if (action === 'booking-send-invoice') {
        await apiFetch(`/api/admin/bookings/${id}/send-invoice`, { method: 'POST' });
        toast('Invoice resent', 'Customer received the updated invoice');
        state.bookings = null;
        state.dashboard = null;
        await refreshView();
      } else if (action === 'booking-mark-paid') {
        await openWorkflowModal({
          title: 'Mark Payment',
          eyebrow: 'Billing Workflow',
          body: `
            <form data-workflow-form>
              <label class="field full">
                <span>Payment method</span>
                <select name="paymentMethod" required>
                  <option value="Cash">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="Card">Card</option>
                  <option value="Online payment link">Online payment link</option>
                  <option value="Bank transfer">Bank transfer</option>
                </select>
              </label>
              <label class="field full">
                <span>Amount</span>
                <input name="amount" type="number" min="0" step="1" placeholder="0" />
              </label>
              <label class="field full">
                <span>Transaction / reference id</span>
                <input name="transactionId" type="text" placeholder="Optional" />
              </label>
              <div class="form-actions">
                <button class="primary-btn" type="submit">Mark paid</button>
                <button class="secondary-btn" type="button" data-close-modal>Cancel</button>
              </div>
            </form>
          `,
          onSubmit: async (form) => {
            const formData = new FormData(form);
            const paymentMethod = String(formData.get('paymentMethod') || '').trim();
            const amountRaw = String(formData.get('amount') || '').trim();
            const transactionId = String(formData.get('transactionId') || '').trim();
            await apiFetch(`/api/admin/bookings/${id}/mark-paid`, {
              method: 'POST',
              body: JSON.stringify({
                paymentMethod,
                paymentStatus: 'Paid',
                amount: amountRaw ? Number(amountRaw) : undefined,
                transactionId
              })
            });
            closeModal();
            toast('Payment recorded', 'Payment captured for booking');
            state.bookings = null;
            state.dashboard = null;
            await refreshView();
          }
        });
      } else if (action === 'booking-download-invoice') {
        try {
          const invoiceUrl = `${API_BASE_URL}/api/admin/bookings/${id}/invoice`;
          logFetchRequest(invoiceUrl, { method: 'GET' });
          const response = await fetch(invoiceUrl, {
            credentials: 'include',
            headers: {
              Accept: 'application/pdf',
              ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
            }
          });
          await logFetchResponse(invoiceUrl, { method: 'GET' }, response);

          if (!response.ok) {
            throw new Error('Invoice download failed');
          }

          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${id}.pdf`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
        } catch (error) {
          toast('Download failed', error.message || 'Could not download invoice', 'error');
        }
      } else if (action === 'booking-delete') {
        await deleteEntity('booking', id);
      } else if (entity === 'driver' || entity === 'car' || entity === 'package' || entity === 'route') {
        if (target.dataset.entityEdit) return editEntity(entity, id);
        if (target.dataset.entityDelete) return deleteEntity(entity, id);
      } else if (target.dataset.customerBlock) {
        await apiFetch(`/api/admin/customers/${target.dataset.customerBlock}/block`, { method: 'PATCH', body: JSON.stringify({ isBlocked: target.dataset.blocked === 'true' }) });
        state.customers = null;
        toast('Customer updated', 'Block status changed');
        await refreshView();
      } else if (target.dataset.customerDelete) {
        await deleteEntity('customer', target.dataset.customerDelete);
      } else if (target.dataset.paymentRefund) {
        await apiFetch(`/api/admin/payments/${target.dataset.paymentRefund}/refund`, { method: 'POST' });
        state.payments = null;
        toast('Refund complete', 'Payment processed');
        await refreshView();
      } else if (target.dataset.messageReply) {
        const messageId = target.dataset.messageReply;
        await openWorkflowModal({
          title: 'Reply to Message',
          eyebrow: 'Support Workflow',
          body: `
            <form data-workflow-form>
              <label class="field full">
                <span>Reply</span>
                <textarea name="reply" rows="5" placeholder="Write a helpful reply to the customer"></textarea>
              </label>
              <div class="form-actions">
                <button class="primary-btn" type="submit">Send reply</button>
                <button class="secondary-btn" type="button" data-close-modal>Cancel</button>
              </div>
            </form>
          `,
          onSubmit: async (form) => {
            const reply = String(new FormData(form).get('reply') || '').trim();
            if (!reply) throw new Error('Reply is required');
            await apiFetch(`/api/admin/messages/${messageId}/reply`, { method: 'POST', body: JSON.stringify({ reply }) });
            closeModal();
            state.messages = null;
            toast('Message replied', 'Customer notified');
            await refreshView();
          }
        });
      } else if (target.dataset.messageResolve) {
        await apiFetch(`/api/admin/messages/${target.dataset.messageResolve}/resolve`, { method: 'PATCH' });
        state.messages = null;
        toast('Message resolved', 'Inquiry marked complete');
        await refreshView();
      } else if (target.dataset.messageDelete) {
        await deleteEntity('message', target.dataset.messageDelete);
      } else if (target.dataset.notificationRead) {
        await apiFetch(`/api/admin/notifications/${target.dataset.notificationRead}/read`, { method: 'PATCH' });
        state.notifications = null;
        await loadNotifications(true);
        renderShellNotifications();
        if (state.view === 'notifications') renderCurrentView();
        toast('Notification read', 'Updated');
      } else if (target.dataset.notificationDelete) {
        await apiFetch(`/api/admin/notifications/${target.dataset.notificationDelete}`, { method: 'DELETE' });
        state.notifications = null;
        await loadNotifications(true);
        renderShellNotifications();
        if (state.view === 'notifications') renderCurrentView();
        toast('Notification removed', 'Deleted successfully');
      }
    } catch (error) {
      toast('Action failed', error.message, 'error');
    }
  }

  async function saveContent() {
    const form = document.getElementById('contentForm');
    if (!form) return;
    try {
      const payload = {};
      form.querySelectorAll('input, textarea, select').forEach((input) => {
        if (!input.name) return;
        payload[input.name] = input.type === 'checkbox' ? input.checked : input.value;
      });
      await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state.settings = null;
      toast('Saved', 'Website content updated');
      await refreshView();
    } catch (error) {
      toast('Save failed', error.message, 'error');
    }
  }

  async function bootstrap() {
    if (!state.token) return showLogin();
    try {
      const me = await apiFetch('/api/admin/auth/me');
      state.admin = me.admin;
      writeJSON(STORAGE_ADMIN, state.admin);
      showApp();
      updateHeaderIdentity();
      syncTopbarSurface();
      syncSidebarMode();
      await Promise.all([loadDashboard(), loadNotifications(true)]);
      connectRealtimeSocket();
      renderCurrentView();
    } catch (error) {
      state.token = '';
      state.admin = null;
      setSession('', null, true);
      showLogin();
      toast('Session expired', error.message, 'error');
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginError('');
    const formData = new FormData(el.loginForm);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    const remember = el.loginForm.querySelector('[name="remember"]').checked;

    try {
      setLoading(true, 'Signing in...');
      const body = await apiFetch('/api/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      const token = body?.token || body?.admin?.token || body?.user?.token || '';
      setSession(token, body.admin, remember);
      showApp();
      toast('Welcome back', `Signed in as ${body.admin?.name || body.admin?.email || 'admin'}`);
      await bootstrap();
    } catch (error) {
      setLoginError(error.message);
      toast('Login failed', error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      if (state.token) await apiFetch('/api/admin/auth/logout', { method: 'POST' });
    } catch (_) {
      // ignore logout failures
    }
    setSession('', null, true);
    state.dashboard = null;
    state.bookings = null;
    state.drivers = null;
    state.cars = null;
    state.packages = null;
    state.routes = null;
    state.customers = null;
    state.payments = null;
    state.invoices = null;
    state.messages = null;
    state.settings = null;
    state.notifications = null;
    disconnectRealtimeSocket();
    if (el.appShell) el.appShell.classList.remove('sidebar-open', 'sidebar-collapsed');
    document.body.classList.remove('shell-open');
    showLogin();
  }

  function wireEvents() {
    el.loginForm.addEventListener('submit', login);
    el.togglePassword.addEventListener('click', () => {
      const input = el.loginForm.querySelector('[name="password"]');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      el.togglePassword.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
    el.logoutButton.addEventListener('click', logout);
    el.sidebarToggle.addEventListener('click', toggleSidebarShell);
    el.sidebarToggleMobile?.addEventListener('click', toggleSidebarShell);
    el.sidebarBackdrop?.addEventListener('click', () => {
      if (!el.appShell) return;
      el.appShell.classList.remove('sidebar-open');
      document.body.classList.remove('shell-open');
      setSidebarBackdropVisible(false);
    });
    window.addEventListener('resize', syncSidebarMode);
    window.addEventListener('scroll', syncTopbarSurface, { passive: true });
    document.addEventListener('click', (event) => {
      const notificationItem = event.target.closest('.notification-item[data-view="notifications"]');
      if (notificationItem) {
        setView('notifications');
        if (isMobileDrawerMode()) {
          el.appShell.classList.remove('sidebar-open');
          document.body.classList.remove('shell-open');
          setSidebarBackdropVisible(false);
        }
        return;
      }
      const closeNotifications = event.target.closest('[data-shell-action="close-notifications"]');
      if (closeNotifications && el.notificationDropdown) {
        el.notificationDropdown.open = false;
      }
    });
    const navRoot = el.sidebarNavRoot || el.sideNav;
    navRoot?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      setView(button.dataset.view);
      el.appShell.classList.remove('sidebar-open');
      document.body.classList.remove('shell-open');
      setSidebarBackdropVisible(false);
      try {
        if (button.dataset.view === 'dashboard' || button.dataset.view === 'analytics') {
          await loadDashboard(true);
          renderCurrentView();
        } else if (button.dataset.view === 'bookings') {
          await loadBookings(true);
          renderCurrentView();
        } else if (button.dataset.view === 'drivers') {
          await loadDrivers(true);
          renderCurrentView();
        } else if (button.dataset.view === 'cars') {
          await loadCars(true);
          renderCurrentView();
        } else if (button.dataset.view === 'packages') {
          await loadPackages(true);
          renderCurrentView();
        } else if (button.dataset.view === 'routes') {
          await loadRoutes(true);
          renderCurrentView();
        } else if (button.dataset.view === 'customers') {
          await loadCustomers(true);
          renderCurrentView();
        } else if (button.dataset.view === 'payments') {
          await loadPayments(true);
          renderCurrentView();
        } else if (button.dataset.view === 'invoices') {
          await loadInvoices(true);
          renderCurrentView();
        } else if (button.dataset.view === 'messages') {
          await loadMessages(true);
          renderCurrentView();
        } else if (button.dataset.view === 'content' || button.dataset.view === 'settings') {
          await loadSettings(true);
          renderCurrentView();
        } else if (button.dataset.view === 'notifications') {
          await loadNotifications(true);
          renderCurrentView();
        }
      } catch (error) {
        toast('Load failed', error.message, 'error');
      }
    });
    el.refreshButton.addEventListener('click', refreshView);
    el.closeModal.addEventListener('click', closeModal);
    el.modalBackdrop.addEventListener('click', (event) => {
      if (event.target === el.modalBackdrop || event.target.closest('[data-close-modal]')) closeModal();
    });
    el.viewRoot.addEventListener('click', handleTableActions);
    el.viewRoot.addEventListener('click', async (event) => {
      const openFormButton = event.target.closest('[data-open-form]');
      if (openFormButton) {
        openForm(openFormButton.dataset.openForm);
      }
      const filterButton = event.target.closest('[data-filter-status]');
      if (filterButton && state.view === 'bookings') {
        state.search = '';
        const searchInput = document.getElementById('bookingSearchInput');
        if (searchInput) searchInput.value = '';
        const status = filterButton.dataset.filterStatus;
        const query = new URLSearchParams();
        if (status) query.set('status', status);
        const body = await apiFetch(`/api/admin/bookings?${query.toString()}`);
        state.bookings = body.bookings || [];
        renderBookingsView();
      }
      const saveContentBtn = event.target.closest('#saveContentBtn');
      if (saveContentBtn) await saveContent();
    });
    el.viewRoot.addEventListener('input', async (event) => {
      const search = event.target.closest('#bookingSearchInput');
      if (search) {
        state.search = search.value.trim();
        const body = await apiFetch(`/api/admin/bookings?search=${encodeURIComponent(state.search)}`);
        state.bookings = body.bookings || [];
        renderBookingsView();
        return;
      }

      const imageInput = event.target.closest('[data-image-preview]');
      if (imageInput) {
        const preview = document.getElementById(imageInput.dataset.imagePreview);
        const status = document.getElementById(imageInput.dataset.imageStatus);
        updatePreviewImage(preview, imageInput.value, status, imageInput.dataset.imageAlt);
      }
    });
    el.globalSearch.addEventListener('input', (event) => {
      state.search = event.target.value.trim();
    });
    el.globalSearch.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      if (state.view === 'bookings') {
        const body = await apiFetch(`/api/admin/bookings?search=${encodeURIComponent(state.search)}`);
        state.bookings = body.bookings || [];
        renderBookingsView();
      }
    });
  }

  async function init() {
    wireEvents();
    syncTopbarSurface();
    if (state.token) {
      await bootstrap();
    } else {
      showLogin();
    }
    updateHeaderIdentity();
    setView('dashboard');
  }

  init().catch((error) => {
    console.error(error);
    toast('Initialization failed', error.message, 'error');
    showLogin();
  });
})();
