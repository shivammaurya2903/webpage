/* Luxury Tour & Travels - Vanilla JS */

(() => {
  const navbar = document.querySelector('[data-navbar]');
  const menuBtn = document.querySelector('[data-menu-button]');
  const menu = document.querySelector('[data-menu]');
  const navLinks = Array.from(document.querySelectorAll('.nav-links a, .mobile-menu a[href^="#"]'));

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

  const form = document.querySelector('[data-booking-form]');
  if (form) {
    const submitBtn = form.querySelector('.submit-btn');
    const passengers = form.querySelector('[name="passengers"]');
    const phone = form.querySelector('[name="phone"]');
    const fullName = form.querySelector('[name="fullName"]');
    const pickupLoc = form.querySelector('[name="pickupLocation"]');
    const dropLoc = form.querySelector('[name="dropLocation"]');
    const pickupDate = form.querySelector('[name="pickupDate"]');
    const dropDate = form.querySelector('[name="dropDate"]');

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

      if (!isPhoneValid(phone?.value.trim())) {
        showError(phone, 'Enter a valid 10-digit phone number.');
        ok = false;
      } else clearError(phone);

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

      const pickup = toDate(pickupDate?.value);
      const drop = toDate(dropDate?.value);
      if (pickup && drop && drop < pickup) {
        showError(dropDate, 'Drop date cannot be earlier than pickup date.');
        ok = false;
      }

      return ok;
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!validate()) return;

      const section = document.querySelector('#booking');
      setSubmitLoading(true);

      window.setTimeout(() => {
        form.querySelector('[data-submit-status]')?.remove();
        const status = document.createElement('div');
        status.dataset.submitStatus = '';
        status.textContent = 'Booking request sent! Our team will contact you shortly.';
        status.className = 'submit-status';
        form.appendChild(status);
        form.reset();
        setSubmitLoading(false);
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 700);
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
})();

