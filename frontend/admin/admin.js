(() => {
  const DEFAULT_API_PORT = '5000';
  const DEFAULT_TIMEOUT_MS = 12000;
  const STORAGE_TOKEN = 'admin_token';
  const STORAGE_ADMIN = 'admin_profile';

  const API_BASE = (() => {
    const override = document.documentElement.dataset.apiBase || window.__API_BASE__;
    if (override) return String(override).replace(/\/$/, '');
    const { protocol, hostname } = window.location;
    if (protocol === 'http:' || protocol === 'https:') {
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return `${protocol}//${hostname}:${String(document.documentElement.dataset.apiPort || window.__API_PORT__ || DEFAULT_API_PORT)}`;
      }
      return window.location.origin.replace(/\/$/, '');
    }
    return `http://localhost:${DEFAULT_API_PORT}`;
  })();

  const el = {
    loginView: document.getElementById('loginView'),
    appView: document.getElementById('appView'),
    loginForm: document.getElementById('adminLoginForm'),
    loginError: document.getElementById('loginError'),
    loginButton: document.getElementById('loginButton'),
    togglePassword: document.getElementById('togglePassword'),
    logoutButton: document.getElementById('logoutButton'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    appShell: document.querySelector('.app-shell'),
    sideNav: document.getElementById('sideNav'),
    viewRoot: document.getElementById('viewRoot'),
    viewLabel: document.getElementById('viewLabel'),
    viewTitle: document.getElementById('viewTitle'),
    globalSearch: document.getElementById('globalSearch'),
    refreshButton: document.getElementById('refreshButton'),
    adminName: document.getElementById('adminName'),
    adminChip: document.getElementById('adminChip'),
    adminAvatar: document.getElementById('adminAvatar'),
    sidebarAvatar: document.getElementById('sidebarAvatar'),
    sidebarAdminName: document.getElementById('sidebarAdminName'),
    sidebarAdminEmail: document.getElementById('sidebarAdminEmail'),
    profileName: document.getElementById('profileName'),
    profileAvatar: document.getElementById('profileAvatar'),
    notificationCount: document.getElementById('notificationCount'),
    notificationList: document.getElementById('notificationList'),
    notificationDropdown: document.getElementById('notificationDropdown'),
    topbar: document.querySelector('.topbar'),
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalEyebrow: document.getElementById('modalEyebrow'),
    modalBody: document.getElementById('modalBody'),
    closeModal: document.getElementById('closeModal'),
    toastHost: document.getElementById('toastHost'),
    socketStatus: document.getElementById('socketStatus')
  };

  const state = {
    token: localStorage.getItem(STORAGE_TOKEN) || sessionStorage.getItem(STORAGE_TOKEN) || '',
    admin: readJSON(STORAGE_ADMIN),
    view: 'dashboard',
    search: '',
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

  function toast(title, message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.innerHTML = `<strong class="toast-title">${escapeHtml(title)}</strong><div class="toast-message">${escapeHtml(message)}</div>`;
    el.toastHost.appendChild(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  async function safeJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return { message: text };
    }
  }

  async function apiFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
      }
    });
    const body = await safeJson(response);
    if (!response.ok) {
      const message = body?.message || body?.error || 'Request failed';
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
    const unreadCount = items.filter((item) => !item.readAt).length;

    if (el.notificationCount) {
      el.notificationCount.hidden = !items.length;
      el.notificationCount.textContent = String(unreadCount || items.length || 0);
    }

    if (el.notificationList) {
      el.notificationList.innerHTML = items.length
        ? items.map((item) => `
          <button type="button" class="notification-item" data-view="notifications">
            <span class="notification-item__icon ${item.readAt ? 'is-read' : ''}"><i class="fa-solid fa-bell"></i></span>
            <span class="notification-item__copy">
              <strong>${escapeHtml(item.title || item.type || 'Notification')}</strong>
              <span>${escapeHtml(item.message || 'Update available')}</span>
              <small>${escapeHtml(fmtDateTime(item.createdAt))}</small>
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
    if (el.profileName) el.profileName.textContent = name;
    if (el.profileAvatar) el.profileAvatar.textContent = initials;
    renderShellNotifications();
  }

  function syncTopbarSurface() {
    if (!el.topbar) return;
    el.topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  }

  function syncSidebarMode() {
    if (!el.appShell) return;
    const isMobile = window.matchMedia('(max-width: 980px)').matches;
    if (!isMobile) {
      el.appShell.classList.remove('sidebar-open');
      document.body.classList.remove('shell-open');
    }
  }

  function toggleSidebarShell() {
    if (!el.appShell) return;
    const isMobile = window.matchMedia('(max-width: 980px)').matches;
    if (isMobile) {
      const isOpen = el.appShell.classList.toggle('sidebar-open');
      document.body.classList.toggle('shell-open', isOpen);
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
    el.sideNav.querySelectorAll('.nav-item').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
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
    el.modalBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.modalBackdrop.hidden = true;
    el.modalBody.innerHTML = '';
    document.body.style.overflow = '';
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

  function tableShell(headers, rowsHtml, emptyText = 'No records found') {
    if (!rowsHtml) {
      return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    }
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
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
            `).join(''), 'No notifications available')}
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
    const query = new URLSearchParams();
    if (state.search) query.set('search', state.search);
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
    renderShellNotifications();
    return state.notifications;
  }

  function renderBookingsView() {
    const bookings = state.bookings || [];
    const bookingStats = {
      total: bookings.length,
      pending: bookings.filter((booking) => String(booking.bookingStatus || '').toLowerCase().includes('pending')).length,
      approved: bookings.filter((booking) => String(booking.bookingStatus || '').toLowerCase().includes('approved')).length,
      paid: bookings.filter((booking) => String(booking.paymentStatus || '').toLowerCase().includes('paid')).length
    };
    const rows = bookings.map((booking) => `
      <tr>
        <td><strong>${escapeHtml(booking.bookingId)}</strong><div class="helper">${escapeHtml(fmtDateTime(booking.createdAt))}</div></td>
        <td>${escapeHtml(booking.customerName)}<div class="helper">${escapeHtml(booking.email || '')}<br>${escapeHtml(booking.phone || '')}</div></td>
        <td>${escapeHtml(booking.pickupLocation)} → ${escapeHtml(booking.dropLocation)}<div class="helper">${escapeHtml(booking.pickupDate ? fmtDate(booking.pickupDate) : '')} ${escapeHtml(booking.pickupTime || '')}</div></td>
        <td>${escapeHtml(booking.selectedCar || '')}<div class="helper">${escapeHtml(booking.selectedPackage || '')}</div></td>
        <td>${renderBadge(booking.bookingStatus)}<div class="helper">${renderBadge(booking.paymentStatus)}</div></td>
        <td>${fmtMoney(booking.totalFare || booking.estimatedFare)}<div class="helper">Invoice: ${escapeHtml(booking.invoiceId || booking.invoice?.invoiceId || '—')}<br>Payment: ${renderBadge(booking.paymentStatus)}</div></td>
        <td>${booking.assignedDriver?.driverName ? escapeHtml(booking.assignedDriver.driverName) : '—'}</td>
        <td>
          ${renderButtons([
            `<button class="small-btn gold" data-action="booking-status" data-id="${booking._id}" data-status="Approved">Approve</button>`,
            `<button class="small-btn gold" data-action="booking-assign" data-id="${booking._id}">Assign</button>`,
            `<button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Started">Start</button>`,
            `<button class="small-btn" data-action="booking-status" data-id="${booking._id}" data-status="Ride Completed">Complete</button>`,
            `<button class="small-btn primary" data-action="booking-generate-invoice" data-id="${booking._id}">Generate invoice</button>`,
            `${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-regenerate-invoice" data-id="${booking._id}">Regenerate</button>` : ''}`,
            `${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn gold" data-action="booking-send-invoice" data-id="${booking._id}">Resend</button>` : ''}`,
            `<button class="small-btn gold" data-action="booking-mark-paid" data-id="${booking._id}">Mark paid</button>`,
            `<button class="small-btn danger" data-action="booking-reject" data-id="${booking._id}">Reject</button>`,
            `${booking.invoiceId || booking.invoice?.invoiceId ? `<button class="small-btn" data-action="booking-download-invoice" data-id="${booking._id}">Download invoice</button>` : ''}`,
            `<button class="small-btn danger" data-action="booking-delete" data-id="${booking._id}">Delete</button>`
          ])}
        </td>
      </tr>
    `).join('');

    el.viewRoot.innerHTML = `
      <div class="view booking-view">
        <section class="booking-hero">
          <div class="card-header booking-header">
            <div>
              <p class="eyebrow">Booking section</p>
              <h3>Booking control</h3>
              <p>Search, filter, accept, reject, assign driver, and delete</p>
            </div>
            <div class="action-row booking-actions">
              <input class="search-pill" id="bookingSearch" type="search" placeholder="Search bookings" value="${escapeHtml(state.search)}" />
              <button class="primary-btn" id="bookingRefreshBtn" type="button">Refresh</button>
            </div>
          </div>

          <ul class="booking-summary">
            <li class="booking-stat">
              <span class="booking-stat__label">Total bookings</span>
              <strong>${bookingStats.total}</strong>
            </li>
            <li class="booking-stat">
              <span class="booking-stat__label">Pending</span>
              <strong>${bookingStats.pending}</strong>
            </li>
            <li class="booking-stat">
              <span class="booking-stat__label">Approved</span>
              <strong>${bookingStats.approved}</strong>
            </li>
            <li class="booking-stat">
              <span class="booking-stat__label">Paid</span>
              <strong>${bookingStats.paid}</strong>
            </li>
          </ul>

          <div class="filter-row booking-filters">
            <button class="secondary-btn" data-filter-status="">All</button>
            <button class="secondary-btn" data-filter-status="Pending">Pending</button>
            <button class="secondary-btn" data-filter-status="Approved">Approved</button>
            <button class="secondary-btn" data-filter-status="Rejected">Rejected</button>
            <button class="secondary-btn" data-filter-status="Driver Assigned">Driver Assigned</button>
            <button class="secondary-btn" data-filter-status="Ride Completed">Completed</button>
            <button class="secondary-btn" data-filter-status="Invoice Generated">Invoice Generated</button>
            <button class="secondary-btn" data-filter-status="Paid">Paid</button>
            <button class="secondary-btn" data-filter-status="Cancelled">Cancelled</button>
          </div>
        </section>
        <section class="card table-card booking-table-card">
          ${tableShell(['Booking', 'Customer', 'Route', 'Vehicle', 'Status', 'Payment', 'Driver', 'Actions'], rows)}
        </section>
      </div>
    `;
  }

  function renderDriversView() {
    const drivers = state.drivers || [];
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
          ${tableShell(['Driver', 'Phone', 'License', 'Assigned vehicle', 'Availability', 'Actions'], rows, 'No drivers found')}
        </section>
      </div>
    `;
  }

  function renderCarsView() {
    const cars = state.cars || [];
    const rows = cars.map((car) => `
      <tr>
        <td>
          <strong>${escapeHtml(car.carName)}</strong>
          <div class="helper">${escapeHtml(car.category || '')}</div>
          ${car.image ? `<img class="preview" src="${escapeHtml(car.image)}" alt="${escapeHtml(car.carName)}" />` : ''}
        </td>
        <td>${escapeHtml(String(car.seatingCapacity || ''))}</td>
        <td>${escapeHtml(car.fuelType || '')}<div class="helper">${escapeHtml(car.transmission || '')}</div></td>
        <td>${fmtMoney(car.pricePerDay)}</td>
        <td>${renderBadge(car.availability ? 'Available' : 'Unavailable')}</td>
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
          <div class="helper">Cars support image upload and feature lists separated by commas or new lines.</div>
        </section>
        <section class="card table-card">
          ${tableShell(['Car', 'Seats', 'Fuel', 'Price/day', 'Availability', 'Features', 'Actions'], rows, 'No cars found')}
        </section>
      </div>
    `;
  }

  function renderPackagesView() {
    const packages = state.packages || [];
    const rows = packages.map((item) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.packageName)}</strong>
          <div class="helper">${escapeHtml(item.duration || '')}</div>
          ${item.image ? `<img class="preview" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.packageName)}" />` : ''}
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
          <div class="helper">Destination, inclusion, and exclusion lists accept comma or line-separated values.</div>
        </section>
        <section class="card table-card">
          ${tableShell(['Package', 'Price', 'Destinations', 'Description', 'Actions'], rows, 'No packages found')}
        </section>
      </div>
    `;
  }

  function renderRoutesView() {
    const routes = state.routes || [];
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
          ${tableShell(['From', 'To', 'Distance', 'Time', 'Price', 'Actions'], rows, 'No routes found')}
        </section>
      </div>
    `;
  }

  function renderCustomersView() {
    const customers = state.customers || [];
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
          ${tableShell(['Customer', 'Phone', 'Status', 'Joined', 'Actions'], rows, 'No customers found')}
        </section>
      </div>
    `;
  }

  function renderPaymentsView() {
    const payments = state.payments || [];
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
          ${tableShell(['Booking', 'Amount', 'Type', 'Status', 'Provider', 'Created', 'Actions'], rows, 'No payments found')}
        </section>
      </div>
    `;
  }

  function renderInvoicesView() {
    const invoices = state.invoices || [];
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
          ${tableShell(['Invoice', 'Customer', 'Amount', 'Status', 'Created', 'Actions'], rows, 'No invoices found')}
        </section>
      </div>
    `;
  }

  function renderMessagesView() {
    const messages = state.messages || [];
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
          ${tableShell(['Sender', 'Subject', 'Message', 'Status', 'Received', 'Actions'], rows, 'No messages found')}
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
            <label class="field wide"><span>Banner image</span><input name="bannerImage" type="file" accept="image/*" /></label>
            <label class="field wide"><span>Currency</span><input name="currency" value="${escapeHtml(settings.paymentSettings?.currency || 'INR')}" /></label>
            <label class="field wide"><span>Advance percent</span><input name="advancePercent" type="number" value="${escapeHtml(String(settings.paymentSettings?.advancePercent ?? 20))}" /></label>
            <label class="field wide"><span>Payment gateway</span><input name="gatewayName" value="${escapeHtml(settings.paymentSettings?.gatewayName || 'Stripe')}" /></label>
            <label class="field full"><span>Testimonials (Name::Quote per line)</span><textarea name="testimonials">${escapeHtml((homepage.testimonials || []).map((item) => `${item.name}::${item.quote}`).join('\n'))}</textarea></label>
            <label class="field full"><span>Fleet highlights (Title::Description per line)</span><textarea name="fleetHighlights">${escapeHtml((homepage.fleetHighlights || []).map((item) => `${item.title}::${item.description}`).join('\n'))}</textarea></label>
            <label class="inline-toggle"><input type="checkbox" name="emailEnabled" ${settings.notificationSettings?.emailEnabled !== false ? 'checked' : ''} /><span>Email notifications enabled</span></label>
            <label class="inline-toggle"><input type="checkbox" name="whatsappEnabled" ${settings.notificationSettings?.whatsappEnabled !== false ? 'checked' : ''} /><span>WhatsApp notifications enabled</span></label>
            <label class="inline-toggle"><input type="checkbox" name="realtimeEnabled" ${settings.notificationSettings?.realtimeEnabled !== false ? 'checked' : ''} /><span>Realtime updates enabled</span></label>
          </div>
          ${settings.homepage?.bannerImage ? `<img class="preview" src="${escapeHtml(settings.homepage.bannerImage)}" alt="Banner preview" />` : ''}
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
    const rows = notifications.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.title || item.type || '')}</strong></td>
        <td>${escapeHtml(item.message || '')}</td>
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
          ${tableShell(['Title', 'Message', 'State', 'Created', 'Actions'], rows, 'No notifications found')}
        </section>
      </div>
    `;
  }

  function renderCurrentView() {
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
          <form class="auth-form" data-save-entity="car" enctype="multipart/form-data">
            <div class="form-grid">
              <label class="field wide"><span>Car name</span><input name="carName" value="${escapeHtml(record?.carName || '')}" required /></label>
              <label class="field wide"><span>Seating capacity</span><input type="number" name="seatingCapacity" value="${escapeHtml(String(record?.seatingCapacity || ''))}" required /></label>
              <label class="field wide"><span>Category</span><input name="category" value="${escapeHtml(record?.category || '')}" required /></label>
              <label class="field wide"><span>Fuel type</span><input name="fuelType" value="${escapeHtml(record?.fuelType || '')}" required /></label>
              <label class="field wide"><span>Transmission</span><input name="transmission" value="${escapeHtml(record?.transmission || '')}" required /></label>
              <label class="field wide"><span>Price/day</span><input type="number" name="pricePerDay" value="${escapeHtml(String(record?.pricePerDay || ''))}" required /></label>
              <label class="field full"><span>Features</span><textarea name="features">${escapeHtml((record?.features || []).join(', '))}</textarea></label>
              <label class="field wide"><span>Car image</span><input name="image" type="file" accept="image/*" /></label>
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
          <form class="auth-form" data-save-entity="package" enctype="multipart/form-data">
            <div class="form-grid">
              <label class="field wide"><span>Package name</span><input name="packageName" value="${escapeHtml(record?.packageName || '')}" required /></label>
              <label class="field wide"><span>Duration</span><input name="duration" value="${escapeHtml(record?.duration || '')}" required /></label>
              <label class="field wide"><span>Price</span><input type="number" name="price" value="${escapeHtml(String(record?.price || ''))}" required /></label>
              <label class="field full"><span>Description</span><textarea name="description">${escapeHtml(record?.description || '')}</textarea></label>
              <label class="field full"><span>Destinations</span><textarea name="destinations">${escapeHtml((record?.destinations || []).join(', '))}</textarea></label>
              <label class="field full"><span>Inclusions</span><textarea name="inclusions">${escapeHtml((record?.inclusions || []).join(', '))}</textarea></label>
              <label class="field full"><span>Exclusions</span><textarea name="exclusions">${escapeHtml((record?.exclusions || []).join(', '))}</textarea></label>
              <label class="field wide"><span>Package image</span><input name="image" type="file" accept="image/*" /></label>
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
              <label class="field wide"><span>Price</span><input type="number" name="price" value="${escapeHtml(String(record?.price || ''))}" required /></label>
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
      } else if (entity === 'package') {
        path = id ? `/api/admin/packages/${id}` : '/api/admin/packages';
        method = id ? 'PUT' : 'POST';
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
        const reason = window.prompt('Rejection reason', 'Not available');
        await apiFetch(`/api/admin/bookings/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Rejected', rejectionReason: reason || '' }) });
        toast('Booking rejected', 'Reason recorded');
        state.bookings = null;
        await refreshView();
      } else if (action === 'booking-assign') {
        const drivers = await loadDrivers();
        if (!drivers.length) throw new Error('No drivers available');
        const options = drivers.map((driver) => `${driver._id}::${driver.driverName}${driver.availability ? '' : ' (busy)'}`).join('\n');
        const selected = window.prompt(`Choose driver by entering driver id:\n${options}`);
        if (!selected) return;
        await apiFetch(`/api/admin/bookings/${id}/assign-driver`, { method: 'PATCH', body: JSON.stringify({ driverId: selected.trim() }) });
        toast('Driver assigned', 'Driver linked to booking');
        state.bookings = null;
        await refreshView();
      } else if (action === 'booking-generate-invoice') {
        await apiFetch(`/api/admin/bookings/${id}/generate-invoice`, { method: 'POST' });
        toast('Invoice generated', 'Invoice is ready for download');
        state.bookings = null;
        state.dashboard = null;
        await refreshView();
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
        const method = window.prompt('Payment method', 'Cash');
        if (!method) return;
        const amount = window.prompt('Payment amount', '');
        const status = ['Card', 'Online payment link'].includes(method.trim()) ? 'Paid Online' : 'Paid Offline';
        await apiFetch(`/api/admin/bookings/${id}/mark-paid`, {
          method: 'POST',
          body: JSON.stringify({ paymentMethod: method.trim(), paymentStatus: status, amount: amount ? Number(amount) : undefined })
        });
        toast('Payment recorded', `${status} captured for booking`);
        state.bookings = null;
        state.dashboard = null;
        await refreshView();
      } else if (action === 'booking-download-invoice') {
        try {
          const response = await fetch(`${API_BASE}/api/admin/bookings/${id}/invoice`, {
            credentials: 'include',
            headers: {
              Accept: 'application/pdf',
              ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
            }
          });

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
        const reply = window.prompt('Reply to customer');
        if (!reply) return;
        await apiFetch(`/api/admin/messages/${target.dataset.messageReply}/reply`, { method: 'POST', body: JSON.stringify({ reply }) });
        state.messages = null;
        toast('Message replied', 'Customer notified');
        await refreshView();
      } else if (target.dataset.messageResolve) {
        await apiFetch(`/api/admin/messages/${target.dataset.messageResolve}/resolve`, { method: 'PATCH' });
        state.messages = null;
        toast('Message resolved', 'Inquiry marked complete');
        await refreshView();
      } else if (target.dataset.messageDelete) {
        await deleteEntity('message', target.dataset.messageDelete);
      } else if (target.dataset.notificationRead) {
        const response = await apiFetch(`/api/admin/notifications/${target.dataset.notificationRead}/read`, { method: 'PATCH' });
        const updated = response.notification || null;
        state.notifications = (state.notifications || []).map((item) => (
          item._id === target.dataset.notificationRead
            ? { ...item, readAt: updated?.readAt || new Date().toISOString() }
            : item
        ));
        renderShellNotifications();
        if (state.view === 'notifications') renderCurrentView();
        toast('Notification read', 'Updated');
      } else if (target.dataset.notificationDelete) {
        await apiFetch(`/api/admin/notifications/${target.dataset.notificationDelete}`, { method: 'DELETE' });
        state.notifications = (state.notifications || []).filter((item) => item._id !== target.dataset.notificationDelete);
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
      const formData = new FormData();
      [...form.elements].forEach((input) => {
        if (!input.name) return;
        if (input.type === 'file') {
          if (input.files[0]) formData.append(input.name, input.files[0]);
          return;
        }
        if (input.type === 'checkbox') {
          formData.append(input.name, input.checked ? 'true' : 'false');
          return;
        }
        formData.append(input.name, input.value);
      });
      await apiFetch('/api/admin/settings', { method: 'PUT', body: formData });
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
      if (window.io) {
        state.socket = window.io(API_BASE, { withCredentials: true, transports: ['websocket', 'polling'] });
        state.socket.on('connect', () => {
          el.socketStatus.innerHTML = '<span></span>Live';
          state.socket.emit('join:admin');
        });
        state.socket.on('disconnect', () => {
          el.socketStatus.innerHTML = '<span style="background: var(--danger);"></span>Offline';
        });
        state.socket.onAny(() => {
          state.dashboard = null;
          state.notifications = null;
          if (state.view === 'dashboard' || state.view === 'notifications') refreshView();
        });
      }
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
      setSession(body.token, body.admin, remember);
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
    if (state.socket) state.socket.disconnect();
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
    window.addEventListener('resize', syncSidebarMode);
    window.addEventListener('scroll', syncTopbarSurface, { passive: true });
    document.addEventListener('click', (event) => {
      const notificationItem = event.target.closest('.notification-item[data-view="notifications"]');
      if (notificationItem) {
        setView('notifications');
        if (window.matchMedia('(max-width: 980px)').matches) {
          el.appShell.classList.remove('sidebar-open');
          document.body.classList.remove('shell-open');
        }
        return;
      }
      const shellAction = event.target.closest('[data-shell-action="logout"]');
      if (shellAction) {
        logout();
        return;
      }
      const closeNotifications = event.target.closest('[data-shell-action="close-notifications"]');
      if (closeNotifications && el.notificationDropdown) {
        el.notificationDropdown.open = false;
      }
    });
    el.sideNav.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      setView(button.dataset.view);
      el.appShell.classList.remove('sidebar-open');
      document.body.classList.remove('shell-open');
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
      if (event.target === el.modalBackdrop) closeModal();
    });
    el.viewRoot.addEventListener('click', handleTableActions);
    el.viewRoot.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-save-entity]');
      if (!form) return;
      event.preventDefault();
      await submitEntityForm(form);
    });
    el.viewRoot.addEventListener('click', async (event) => {
      const openFormButton = event.target.closest('[data-open-form]');
      if (openFormButton) {
        openForm(openFormButton.dataset.openForm);
      }
      const filterButton = event.target.closest('[data-filter-status]');
      if (filterButton && state.view === 'bookings') {
        state.search = '';
        const searchInput = document.getElementById('bookingSearch');
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
      const search = event.target.closest('#bookingSearch');
      if (!search) return;
      state.search = search.value.trim();
      const body = await apiFetch(`/api/admin/bookings?search=${encodeURIComponent(state.search)}`);
      state.bookings = body.bookings || [];
      renderBookingsView();
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
