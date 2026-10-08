/* ubonudonkang.com forms: one script for every form on the site.
 *
 * Each form says what it is with data-form, and everything posts to the one
 * Apps Script web app (scripts/site_forms.gs), which routes it to a tab in the
 * same workbook:
 *
 *   data-form="contact"   contact page enquiry            -> Contact tab
 *   data-form="waitlist"  BA Bridge cohort waitlist       -> Waitlist tab
 *   data-form="enrol"     BA Bridge enrolment + Selar     -> BA Training tab
 *
 * Needs /js/site.js first (window.uuTrack and selarCheckoutUrl).
 */
(function () {
  'use strict';

  // The only place the endpoint lives. A form can override it with data-endpoint.
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT/exec';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const track = (name) => { if (window.uuTrack) window.uuTrack(name); };

  /* ── Transport ──────────────────────────────────────────────────
     Read the JSON answer when the browser allows it, so a rejected or failed
     save is reported. Apps Script's redirect can lack CORS headers; the answer
     is then unreadable, so the request is sent again blind (no-cors). Every
     form carries a unique id or reference and the script ignores repeats, so
     the resend cannot create a second row. A blind send is not proof of save. */
  function send(endpoint, params) {
    const body = new URLSearchParams(params);
    return fetch(endpoint, { method: 'POST', body })
      .then((r) => r.json())
      .then((res) => { if (!res || res.result !== 'ok') throw new Error('rejected'); })
      .catch((err) => {
        if (err && err.message === 'rejected') throw err;
        return fetch(endpoint, { method: 'POST', mode: 'no-cors', body }).then(() => {});
      });
  }

  function collect(form) {
    const out = {};
    new FormData(form).forEach((value, key) => {
      if (typeof value !== 'string') return;
      const text = value.trim();
      out[key] = key in out ? out[key] + ', ' + text : text;
    });
    return out;
  }

  const uniqueId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

  const once = (el, type, fn) => el.addEventListener(type, fn, { once: true });

  /* ── Contact and waitlist: notice-style forms ───────────────────── */
  function initNotice(form, kind) {
    const endpoint = form.dataset.endpoint || ENDPOINT;
    const done = document.querySelector('[data-fs-success]');
    const failed = document.querySelector('[data-fs-error]');
    const button = form.querySelector('button[type="submit"]');
    const label = button.innerHTML;
    const fallbackText = form.dataset.errorText || 'Something went wrong. Please email ubonudonkang@gmail.com.';
    let sending = false;

    const reveal = (el, text) => {
      if (text) el.textContent = text;
      el.style.display = 'block';
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (sending) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }

      const params = collect(form);
      params.submission_id = uniqueId();

      sending = true;
      button.disabled = true;
      button.textContent = 'Sending…';
      failed.style.display = 'none';
      done.style.display = 'none';

      send(endpoint, params)
        .then(() => {
          form.reset();
          reveal(done);
          if (kind === 'contact') track('contact-enquiry-' + (params.type || 'unspecified'));
        })
        .catch(() => reveal(failed, fallbackText))
        .then(() => {
          sending = false;
          button.disabled = false;
          button.innerHTML = label;
        });
    });

    if (kind === 'contact') prefillRequest(form);
    if (kind === 'waitlist') initEarlierPayment(form);
  }

  /* Contact: prefill a document request (?request=…&from=…) */
  function prefillRequest(form) {
    const params = new URLSearchParams(location.search);
    const doc = params.get('request');
    if (!doc) return;
    const from = params.get('from');
    const type = form.querySelector('#ty');
    const msg = form.querySelector('#msg');
    if (type) type.value = 'resource';
    if (msg && !msg.value) {
      msg.value = `Hi Ubon, I'd like to request "${doc}"${from ? ` (from the ${from})` : ''}. `;
    }
    (form.closest('.form-card') || form).scrollIntoView({ block: 'start' });
    form.querySelector('#fn')?.focus({ preventScroll: true });
  }

  /* ── BA Bridge payment memory (shared by the enrol and waitlist forms) ──
     A browser return from Selar is not verified payment. It only lets a buyer
     see their reference again. */
  function paymentStore(form) {
    const prefix = form.dataset.storagePrefix;
    const cohort = form.dataset.cohort || '';
    const keys = { pending: prefix + '-pending', returned: prefix + '-returned' };

    const valid = (v) => v && v.product === 'ba-bridge-selar' &&
      (!cohort || v.cohort === cohort) &&
      typeof v.reference === 'string' && /^BAB-/.test(v.reference) &&
      typeof v.name === 'string' && v.name &&
      typeof v.email === 'string' && EMAIL_RE.test(v.email);

    const read = (key) => {
      try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return valid(v) ? v : null; }
      catch (e) { return null; }
    };
    return {
      pending: () => read(keys.pending),
      returned: () => read(keys.returned),
      // Before cohorts were recorded on purchases.
      legacy: () => {
        try {
          const v = JSON.parse(sessionStorage.getItem('uu-cohort-selar-pending') || 'null');
          return v && v.product === 'ba-bridge-selar' && !v.cohort && /^BAB-/.test(v.reference || '') &&
            EMAIL_RE.test(v.email || '') ? v : null;
        } catch (e) { return null; }
      },
      remember: (v) => { try { sessionStorage.setItem(keys.pending, JSON.stringify(v)); } catch (e) { /* checkout still works */ } },
      markReturned: (v) => { try { sessionStorage.setItem(keys.returned, JSON.stringify(v)); } catch (e) { /* this visit still shows it */ } },
    };
  }

  function clearPaymentParam() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('payment')) return;
    url.searchParams.delete('payment');
    const query = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (query ? '?' + query : '') + url.hash);
  }

  function showReturnedPayment(form, customer) {
    document.getElementById('done-ref').textContent = customer.reference;
    form.hidden = true;
    const card = document.getElementById('form-done');
    card.hidden = false;
    card.focus({ preventScroll: true });
    return card;
  }

  /* Closed cohort: someone who paid before registration closed can still see their reference. */
  function initEarlierPayment(form) {
    if (!form.dataset.storagePrefix) return;
    const store = paymentStore(form);
    const status = document.getElementById('payment-status');
    const isReturn = new URLSearchParams(location.search).get('payment') === 'selar';
    const pending = store.pending();

    if (isReturn) {
      clearPaymentParam();
      if (pending) {
        store.markReturned(pending);
        showReturnedPayment(form, pending);
        track('cohort-selar-returned');
      } else {
        status.textContent = 'If you completed an earlier payment, please contact us with your Selar receipt so we can check it.';
      }
      return;
    }
    const earlier = store.returned();
    if (earlier) showReturnedPayment(form, earlier);
    else if (pending) status.textContent = 'Registration is closed. If you already paid, contact us with reference ' + pending.reference + '.';
  }

  /* ── BA Bridge enrolment: save the application, then hand over to Selar ── */
  function initEnrol(form) {
    const endpoint = form.dataset.endpoint || ENDPOINT;
    const cohort = form.dataset.cohort;
    const amount = form.dataset.amount;
    const selarUrl = form.dataset.selarUrl;
    const store = paymentStore(form);
    const statusEl = document.getElementById('form-status');
    const submitBtn = document.getElementById('submit-btn');
    const retryBtn = document.getElementById('pay-retry');
    const doneEl = document.getElementById('form-done');
    const refEl = document.getElementById('done-ref');

    /* "Other" text inputs reveal when Other is picked */
    const toggleOther = (targetId, active) => {
      const box = document.getElementById(targetId);
      if (!box) return;
      box.hidden = !active;
      if (active) box.focus(); else box.value = '';
    };
    form.querySelectorAll('select[data-other]').forEach((sel) => {
      sel.addEventListener('change', () => toggleOther(sel.dataset.other, sel.value === 'Other'));
    });
    form.querySelectorAll('input[type=checkbox][data-other]').forEach((box) => {
      box.addEventListener('change', () => toggleOther(box.dataset.other, box.checked));
    });

    /* Checkbox pills: visual state, and the cap on multi-select groups */
    form.querySelectorAll('.f-checks').forEach((group) => {
      const max = parseInt(group.dataset.max || '0', 10);
      group.addEventListener('change', () => {
        const boxes = group.querySelectorAll('input[type=checkbox]');
        const checked = group.querySelectorAll('input[type=checkbox]:checked').length;
        boxes.forEach((box) => {
          const pill = box.closest('.f-check');
          pill.classList.toggle('checked', box.checked);
          if (max) {
            const atMax = checked >= max && !box.checked;
            box.disabled = atMax;
            pill.classList.toggle('maxed', atMax);
          }
        });
      });
    });
    form.querySelectorAll('.f-consent input').forEach((box) => {
      box.addEventListener('change', () => box.closest('.f-check').classList.toggle('checked', box.checked));
    });

    const showError = (msg, el) => {
      statusEl.textContent = msg;
      statusEl.classList.remove('ok');
      if (!el) return;
      el.classList.add('invalid');
      el.focus({ preventScroll: false });
      once(el, 'input', () => el.classList.remove('invalid'));
    };

    function startPayment() {
      const pending = store.pending();
      if (!pending) {
        statusEl.classList.remove('ok');
        statusEl.textContent = 'We could not restore your saved enrolment. Please submit the form again.';
        return;
      }
      retryBtn.hidden = true;
      statusEl.classList.add('ok');
      statusEl.textContent = 'Taking you to secure payment...';
      track('cohort-selar-checkout-opened');
      window.location.assign(selarCheckoutUrl(selarUrl, pending));
    }
    retryBtn.addEventListener('click', startPayment);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      statusEl.textContent = '';

      const required = form.querySelectorAll('[required]');
      for (let i = 0; i < required.length; i++) {
        const el = required[i];
        if (el.type === 'checkbox') {
          if (!el.checked) { showError('Please tick the consent box to continue.', el); return; }
        } else if (!el.value.trim()) {
          showError('Please fill in every field marked with a star.', el); return;
        } else if (el.type === 'email' && !EMAIL_RE.test(el.value)) {
          showError('That email address does not look right.', el); return;
        }
      }
      if (!form.querySelector('input[name=wants]:checked')) { showError('Pick at least one thing you want from the program.'); return; }
      if (!form.querySelector('input[name=availability]:checked')) { showError('Pick at least one time you could attend.'); return; }

      const data = collect(form);

      /* Fold any "Other" text into its parent answer so the sheet keeps one column per question. */
      ['background', 'wants', 'budget', 'source'].forEach((key) => {
        const extra = (data[key + '_other'] || '').trim();
        delete data[key + '_other'];
        if (extra && data[key]) data[key] = data[key].replace(/\bOther\b/, 'Other: ' + extra);
      });

      /* The application is saved before checkout so it can be reconciled with a Selar sale. */
      const ref = 'BAB-' + Date.now().toString(36).toUpperCase() + '-' +
        Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const buyer = { name: data.name || '', email: data.email || '', whatsapp: data.whatsapp || '' };
      Object.assign(data, { reference: ref, amount, cohort, payment_status: 'Awaiting payment', action: 'signup' });

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      send(endpoint, data)
        .then(() => {
          store.remember({ reference: ref, name: buyer.name, email: buyer.email, whatsapp: buyer.whatsapp, product: 'ba-bridge-selar', cohort });
          submitBtn.hidden = true;
          refEl.textContent = ref;
          track('cohort-enrolment-started');
          startPayment();
        })
        .catch(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continue to payment';
          showError('That did not go through. Please try again. Cohort enquiries: ubonanalyst@gmail.com.');
        });
    });

    /* Restore state after a refresh or a return from Selar */
    const isReturn = new URLSearchParams(location.search).get('payment') === 'selar';
    const pending = store.pending();
    const show = (customer) => {
      statusEl.textContent = '';
      retryBtn.hidden = true;
      showReturnedPayment(form, customer).scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    if (isReturn) {
      clearPaymentParam();
      if (!pending) {
        const earlier = store.legacy();
        if (earlier) show(earlier);
        else statusEl.textContent = 'We could not restore this payment return. Please contact us if you completed payment.';
        return;
      }
      store.markReturned(pending);
      show(pending);
      track('cohort-selar-returned');
      return;
    }
    const returned = store.returned();
    if (returned) { show(returned); return; }
    if (pending) {
      submitBtn.hidden = true;
      refEl.textContent = pending.reference;
      statusEl.classList.add('ok');
      statusEl.textContent = 'Your enrolment is saved. Continue to secure payment when you are ready.';
      retryBtn.hidden = false;
    }
  }

  document.querySelectorAll('form[data-form]').forEach((form) => {
    const kind = form.dataset.form;
    if (kind === 'contact' || kind === 'waitlist') initNotice(form, kind);
    else if (kind === 'enrol') initEnrol(form);
  });
})();
