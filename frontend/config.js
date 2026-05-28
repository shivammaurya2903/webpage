(() => {
  const LOCAL_API_URL = 'http://localhost:5000';
  const PRODUCTION_API_URL = 'https://webpage-96yf.onrender.com';
  const DEFAULT_TIMEOUT_MS = 12000;
  const DEFAULT_RETRY_DELAY_MS = 500;

  function isLocalDevelopment() {
    if (window.location.protocol === 'file:') return true;

    const hostname = String(window.location.hostname || '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  }

  const apiBaseUrl = String(isLocalDevelopment() ? LOCAL_API_URL : PRODUCTION_API_URL).replace(/\/$/, '');
  const socketBaseUrl = apiBaseUrl;

  window.APP_CONFIG = Object.freeze({
    API_BASE_URL: apiBaseUrl,
    SOCKET_BASE_URL: socketBaseUrl,
    DEFAULT_TIMEOUT_MS,
    API_RETRY_DELAY_MS: DEFAULT_RETRY_DELAY_MS
  });

  window.API_BASE_URL = apiBaseUrl;
  window.SOCKET_BASE_URL = socketBaseUrl;
})();