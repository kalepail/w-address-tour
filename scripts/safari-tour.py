"""Clicks through the whole tour in real desktop Safari (safaridriver, W3C
WebDriver) against the live testnet. Start `safaridriver --port 4444` first.
  python3 scripts/safari-tour.py [url] [outdir]"""
import base64, json, os, sys, time, urllib.error, urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5299/'
OUT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.design/safari')
D = 'http://localhost:4444'

def call(method, path, body=None):
    req = urllib.request.Request(D + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)['value']
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read()[:400]!r}')

sid = call('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'safari'}}})['sessionId']
js = lambda code: call('POST', f'/session/{sid}/execute/sync', {'script': code, 'args': []})
shot = lambda name: open(f'{OUT}/{name}.png', 'wb').write(base64.b64decode(call('GET', f'/session/{sid}/screenshot')))
STATE = 'return (document.getElementById("next").disabled ? "busy" : document.querySelector(".error-box") ? "error" : "ready") + " | " + (document.querySelector(".eyebrow")||{}).textContent'
try:
    call('POST', f'/session/{sid}/window/rect', {'width': 1440, 'height': 900})
    call('POST', f'/session/{sid}/url', {'url': URL})
    time.sleep(1.5)
    js('window.__errs = []; window.addEventListener("error", e => window.__errs.push(String(e.message)));'
       'const ce = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(" ")); ce(...a); };')
    shot('0')
    start = time.time()
    for i in range(1, 10):
        js('document.getElementById("next").click()')
        time.sleep(0.5)
        for k in range(120):
            st = js(STATE)
            if st.startswith('ready') or st.startswith('error'):
                break
            time.sleep(1)
        print(f'step {i}: {st}', flush=True)
        js('window.scrollTo(0,0)')
        time.sleep(0.3)
        shot(str(i))
        if st.startswith('error'):
            print(js('return document.querySelector(".error-box").innerText'))
            sys.exit(1)
    print(f'total {time.time() - start:.0f}s')
    print('errors:', js('return window.__errs'))
    print('UA:', js('return navigator.userAgent'))
finally:
    call('DELETE', f'/session/{sid}')
