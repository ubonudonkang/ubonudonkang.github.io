"""Local checks; external requests are blocked and no real forms/payments are sent."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        context = browser.new_context()
        context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        paths = ['/', '/projects/', '/ba-training/', '/project-ams/', '/project-rpa-treasury/', '/notes/ecba-vs-ccba-vs-cbap/', '/resources/ba-workbench/', '/contact/']
        for width in (390, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            for path in paths:
                assert page.goto(base + path).status == 200
                page.wait_for_timeout(150)
                assert page.locator('h1').count() == 1, path
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (path, width, 'overflow')
                for data in page.locator('script[type="application/ld+json"]').all_text_contents():
                    json.loads(data)
                if path == '/resources/ba-workbench/':
                    assert page.get_by_text('A free toolkit for business analysts', exact=True).is_visible()
                    assert page.locator('#content').inner_text() != 'Loading workbench…'
        assert not errors, errors
        assert page.request.get(base + '/docs/ams/data-dictionary.pdf').status == 404
        # Formspree can reset controls before its success notice changes.
        page.goto(base + '/contact/')
        page.evaluate('''() => {
          window.events = [];
          window.goatcounter = {count: e => events.push(e.path)};
          const f = document.getElementById('contact-form');
          document.getElementById('ty').value = 'consulting';
          f.addEventListener('submit', e => e.preventDefault());
          f.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
          f.reset();
          document.querySelector('[data-fs-success]').style.display = 'block';
        }''')
        page.wait_for_timeout(50)
        assert page.evaluate('events') == ['contact-enquiry-consulting']
        # Fake the checkout widget and deliberately send duplicate success callbacks.
        page.evaluate('''async () => {
          window.events = []; window.successes = 0;
          window.squad = function(options) {
            window.checkoutOptions = options;
            this.setup = () => {}; this.open = () => {};
          };
          await window.squadPay({label:'cohort', amount:80000, email:'test@example.test', name:'Test', ref:'LOCAL-TEST', onSuccess:() => successes++});
          checkoutOptions.onSuccess({}); checkoutOptions.onSuccess({}); checkoutOptions.onClose();
        }''')
        assert page.evaluate('events') == ['cohort-checkout-opened', 'cohort-checkout-success']
        assert page.evaluate('successes') == 1
        page.evaluate('''async () => {
          window.goatcounter.count = () => { throw new Error('analytics unavailable'); };
          await window.squadPay({label:'session', amount:15000, email:'test@example.test', name:'Test', ref:'LOCAL-TEST-2', onSuccess:() => successes++});
          checkoutOptions.onSuccess({});
        }''')
        assert page.evaluate('successes') == 2
        nojs = browser.new_context(java_script_enabled=False)
        nojs.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
        static = nojs.new_page()
        static.goto(base + '/resources/ba-workbench/')
        assert static.get_by_text('A free toolkit for business analysts', exact=True).is_visible()
        browser.close()
    print('PASS: 8 pages at mobile/desktop sizes; structured data; persistent/no-JS guide; PDF 404; form attribution; checkout event deduplication; analytics failure isolation.')
finally:
    server.shutdown()
