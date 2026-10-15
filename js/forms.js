/* ubonudonkang.com forms: one script for every form on the site.
 *
 * Each form says what it is with data-form, and everything posts to the one
 * Apps Script web app (scripts/site_forms.gs), which routes it to a tab in the
 * same workbook:
 *
 *   data-form="contact"   contact page enquiry            -> Contact tab
 *   data-form="waitlist"  BA Bridge cohort waitlist       -> Waitlist tab
 *   data-form="enrol"     BA Bridge enrolment + Squad     -> BA Training tab
 *
 * Needs /js/site.js first (window.uuTrack).
 */
(function () {
  'use strict';

  // The only place the endpoint lives. A form can override it with data-endpoint.
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycby94krvGfIS7mXVT-szoGHHM_pCLIU11Bh_AemMxE_nsK-X_Hm1y8yaK69zNKfU20LT/exec';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const track = (name) => { if (window.uuTrack) window.uuTrack(name); };

  /* ── Squad checkout ─────────────────────────────────────────────
     The public key is meant to sit in page code: sandbox_pk_... while testing,
     pk_... live. The secret key never goes here; it lives in the Apps Script,
     which checks every payment with Squad before it counts. squad.min.js loads
     on first use. If you enforce a Content Security Policy, allow
     checkout.squadco.com in script-src and frame-src. */
  const SQUAD_PUBLIC_KEY = '';
  const SQUAD_WIDGET = 'https://checkout.squadco.com/widget/squad.min.js';
  const SQUAD_REF = /^(BAB-[A-Z0-9]+-[A-Z0-9]{3})-\d{1,3}$/;
  let squadLoading = null;

  function loadSquad() {
    if (window.squad) return Promise.resolve();
    if (!squadLoading) {
      squadLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = SQUAD_WIDGET;
        script.async = true;
        script.onload = () => (window.squad ? resolve() : reject(new Error('Secure checkout did not load.')));
        script.onerror = () => { squadLoading = null; reject(new Error('Secure checkout did not load.')); };
        document.head.appendChild(script);
      });
    }
    return squadLoading;
  }

  // amount in naira; Squad wants kobo
  function squadPay({ amount, email, name, ref, metadata, onSuccess, onClose }) {
    if (!SQUAD_PUBLIC_KEY) return Promise.reject(new Error('Online payment is not switched on yet.'));
    return loadSquad().then(() => {
      let paid = false;
      const checkout = new window.squad({
        key: SQUAD_PUBLIC_KEY,
        email,
        amount: Math.round(amount * 100),
        currency_code: 'NGN',
        transaction_ref: ref,
        customer_name: name,
        metadata,
        pass_charge: false,
        onLoad: () => {},
        onSuccess: () => { paid = true; onSuccess(); },
        onClose: () => { if (!paid) onClose(); },
      });
      checkout.setup();
      checkout.open();
    });
  }

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
     A browser return is not verified payment (the Apps Script checks every
     payment with Squad). It only lets a buyer see their reference again. */
  function paymentStore(form) {
    const prefix = form.dataset.storagePrefix;
    const cohort = form.dataset.cohort || '';
    const keys = { pending: prefix + '-pending', returned: prefix + '-returned' };

    // 'ba-bridge-selar' is the earlier provider; those buyers can still see their reference.
    const valid = (v) => v && (v.product === 'ba-bridge-selar' || v.product === 'ba-bridge-squad') &&
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
      remember: (v) => { try { sessionStorage.setItem(keys.pending, JSON.stringify(v)); } catch (e) { /* checkout still works */ } },
      markReturned: (v) => { try { sessionStorage.setItem(keys.returned, JSON.stringify(v)); } catch (e) { /* this visit still shows it */ } },
    };
  }

  /* A buyer comes back with ?payment=selar (the earlier provider) or ?reference=BAB-...-N
     (Squad's redirect URL adds the transaction reference). */
  function paymentReturn() {
    const params = new URLSearchParams(location.search);
    const reference = (params.get('reference') || '').trim();
    const squadRef = SQUAD_REF.test(reference) ? reference : '';
    return { selar: params.get('payment') === 'selar', squadRef };
  }

  function clearPaymentParams() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('payment') && !url.searchParams.has('reference')) return;
    url.searchParams.delete('payment');
    url.searchParams.delete('reference');
    const query = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (query ? '?' + query : '') + url.hash);
  }

  // Squad also tells the endpoint itself (webhook); this only makes the check quicker.
  const reportPayment = (endpoint, squadRef) =>
    send(endpoint, { action: 'payment', squad_ref: squadRef }).catch(() => {});

  const belongsTo = (pending, squadRef) => !squadRef || squadRef.indexOf(pending.reference + '-') === 0;

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
    const endpoint = form.dataset.endpoint || ENDPOINT;
    const store = paymentStore(form);
    const status = document.getElementById('payment-status');
    const back = paymentReturn();
    const pending = store.pending();

    if (back.selar || back.squadRef) {
      clearPaymentParams();
      if (back.squadRef) reportPayment(endpoint, back.squadRef);
      if (pending && belongsTo(pending, back.squadRef)) {
        store.markReturned(pending);
        showReturnedPayment(form, pending);
        track(back.squadRef ? 'cohort-squad-paid' : 'cohort-selar-returned');
      } else {
        status.textContent = 'If you completed an earlier payment, please contact us with your payment receipt so we can check it.';
      }
      return;
    }
    const earlier = store.returned();
    if (earlier) showReturnedPayment(form, earlier);
    else if (pending) status.textContent = 'Registration is closed. If you already paid, contact us with reference ' + pending.reference + '.';
  }

  /* ── BA Bridge enrolment: save the application, then open Squad checkout ── */
  function initEnrol(form) {
    const endpoint = form.dataset.endpoint || ENDPOINT;
    const cohort = form.dataset.cohort;
    const amount = form.dataset.amount;
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

    const received = (customer) => {
      statusEl.textContent = '';
      retryBtn.hidden = true;
      showReturnedPayment(form, customer).scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    function paid(pending, squadRef) {
      store.markReturned(pending);
      track('cohort-squad-paid');
      received(pending);
      reportPayment(endpoint, squadRef);
    }

    // Squad needs a fresh transaction reference for every attempt: BAB-...-1, -2, ...
    function startPayment() {
      const pending = store.pending();
      if (!pending) {
        statusEl.classList.remove('ok');
        statusEl.textContent = 'We could not restore your saved enrolment. Please submit the form again.';
        return;
      }
      pending.attempt = (pending.attempt || 0) + 1;
      store.remember(pending);
      const squadRef = pending.reference + '-' + pending.attempt;

      retryBtn.hidden = true;
      statusEl.classList.add('ok');
      statusEl.textContent = 'Opening secure checkout...';
      track('cohort-squad-checkout-opened');

      squadPay({
        amount: Number(amount), email: pending.email, name: pending.name, ref: squadRef,
        metadata: { product: 'BA Bridge Cohort', reference: pending.reference, cohort, whatsapp: pending.whatsapp || '' },
        onSuccess: () => paid(pending, squadRef),
        onClose: () => {
          statusEl.classList.remove('ok');
          statusEl.textContent = "Payment wasn't completed. Your details are saved, so you can pay now.";
          retryBtn.hidden = false;
          retryBtn.focus();
        },
      }).then(() => { statusEl.textContent = ''; }).catch((err) => {
        statusEl.classList.remove('ok');
        statusEl.textContent = err.message + ' Please try again shortly.';
        retryBtn.hidden = false;
      });
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

      /* The application is saved before checkout so a payment can be matched to it. */
      const ref = 'BAB-' + Date.now().toString(36).toUpperCase() + '-' +
        Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      const buyer = { name: data.name || '', email: data.email || '', whatsapp: data.whatsapp || '' };
      Object.assign(data, { reference: ref, amount, cohort, payment_status: 'Awaiting payment', action: 'signup' });

      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving...';

      send(endpoint, data)
        .then(() => {
          store.remember({ reference: ref, name: buyer.name, email: buyer.email, whatsapp: buyer.whatsapp, product: 'ba-bridge-squad', cohort });
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

    /* Restore state after a refresh, or a return through Squad's redirect URL */
    const back = paymentReturn();
    const pending = store.pending();

    if (back.squadRef) {
      clearPaymentParams();
      reportPayment(endpoint, back.squadRef);
      if (pending && belongsTo(pending, back.squadRef)) {
        store.markReturned(pending);
        received(pending);
        track('cohort-squad-paid');
      } else {
        statusEl.textContent = 'If you have paid, Squad confirms it to us automatically. Contact us if you do not hear from us soon.';
      }
      return;
    }
    const returned = store.returned();
    if (returned) { received(returned); return; }
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
