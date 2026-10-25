"""The hosted, installable editor (scripts/build-site.mjs) served over HTTP like GitHub Pages:
manifest and icons load, the service worker serves the editor offline, a new release reaches
the page on the next online start, and the beta channel in beta/ keeps its own worker.
Needs a fresh `npm run build`.
"""
import functools
import json
import os
import subprocess
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_env import launch

root=Path(__file__).resolve().parents[1]
assert (root/'dist'/'index.html').exists(), 'Build the editor (npm run build) before running this test'
engine=os.environ.get('EDITOR_BROWSER','chromium')
served=Path(tempfile.mkdtemp(prefix='dnd-site-'))
site=served/'dnd-editor'  # GitHub Pages serves a project under /<repo>/
for args in (['stable',str(site)],['beta',str(site/'beta')]):
    subprocess.run(['node','scripts/build-site.mjs',*args],cwd=root,check=True,stdout=subprocess.DEVNULL)

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.webmanifest':'application/manifest+json'}
    def log_message(self,*args):
        pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(served)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base='http://127.0.0.1:%d/dnd-editor/'%server.server_address[1]

def controlled(page):
    """Wait until the service worker controls the page; return its script URL."""
    page.wait_for_function('navigator.serviceWorker&&navigator.serviceWorker.controller',timeout=15000)
    return page.evaluate('navigator.serviceWorker.controller.scriptURL')

def editor_ready(page):
    page.wait_for_function("document.documentElement.dataset.storage&&document.querySelector('#page1 .el')",timeout=15000)

with sync_playwright() as p:
    browser=launch(p)
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))

    page.goto(base)
    editor_ready(page)
    assert controlled(page)==base+'sw.js'
    assert page.evaluate("document.querySelector('meta[name=editor-channel]').content")=='stable'
    manifest=page.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r=>r.json())")
    assert manifest['display']=='standalone' and manifest['start_url']=='./', manifest
    for icon in manifest['icons']:
        assert page.evaluate('src=>fetch(src).then(r=>r.ok)',icon['src']), icon
    print('PASS '+engine+': hosted editor has a manifest with icons and a service worker')

    # Offline: the worker serves the editor saved on the last start.
    context.set_offline(True)
    page.reload()
    editor_ready(page)
    assert page.locator('#page1 .el').count()>10
    context.set_offline(False)
    print('PASS '+engine+': editor opens without network')

    # A new release on the site reaches the page on the next start, no download needed.
    index=site/'index.html'
    index.write_text(index.read_text(encoding='utf-8').replace('</head>','<meta name="release-mark" content="next"/></head>'),encoding='utf-8')
    page.reload()
    editor_ready(page)
    assert page.locator('meta[name="release-mark"]').count()==1, 'Online start must load the newest editor'
    context.set_offline(True)
    page.reload()
    editor_ready(page)
    assert page.locator('meta[name="release-mark"]').count()==1, 'Offline start must use the newest saved editor'
    context.set_offline(False)
    print('PASS '+engine+': new release arrives online and stays offline')

    # «Скачать HTML» from the app is a plain offline file, without the app parts.
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as download:
        page.locator('#export').click()
    exported=Path(download.value.path()).read_text(encoding='utf-8')
    for part in ('<script data-app-only','rel="manifest"','<meta name="editor-channel"','<meta name="theme-color"'):
        assert part not in exported, part
    print('PASS '+engine+': exported HTML has no app-only parts')

    # In the app the document is a layout file: Ctrl+S suggests «….dnd» and writes the layout JSON.
    page.evaluate("""()=>{window.files=[];window.picks=[];
      window.showSaveFilePicker=async options=>{window.picks.push({name:options.suggestedName,first:Object.values(options.types[0].accept)[0][0]});
        return {name:options.suggestedName,createWritable:async()=>{let text='';return {write:async d=>{text+=d},close:async()=>{window.files.push(text)}}}}}}""")
    page.keyboard.press('Control+s')
    page.wait_for_function('window.files.length===1')
    pick=page.evaluate('window.picks[0]')
    assert pick['name'].endswith('.dnd') and pick['first']=='.dnd',pick
    layout=json.loads(page.evaluate('window.files[0]'))
    assert layout['format']=='dnd-card-editor/layout' and layout['id']==page.evaluate('document.documentElement.dataset.layoutId') and len(layout['items'])>10
    print('PASS '+engine+': in the app Ctrl+S saves a .dnd layout file')

    # The beta in beta/ has its own worker, manifest and icon; the main worker leaves it alone.
    beta=context.new_page()
    beta.on('pageerror',lambda error:errors.append(str(error)))
    beta.goto(base+'beta/')
    editor_ready(beta)
    assert controlled(beta)==base+'beta/sw.js'
    assert beta.evaluate("document.querySelector('meta[name=editor-channel]').content")=='beta'
    beta_manifest=beta.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r=>r.json())")
    assert 'бета' in beta_manifest['name'] and beta_manifest['icons'][0]['src'].startswith('icon-beta'), beta_manifest
    caches=beta.evaluate('caches.keys()')
    assert any(key.startswith('dnd-editor-stable-') for key in caches) and any(key.startswith('dnd-editor-beta-') for key in caches), caches
    # Beta keeps its saves apart from the main app on the same site.
    for target in (page,beta):
        target.wait_for_function("document.documentElement.dataset.saveState==='saved'")
    names=beta.evaluate('indexedDB.databases().then(list=>list.map(db=>db.name))')
    assert 'dnd-card-editor' in names and 'dnd-card-editor-beta' in names, names
    assert beta.evaluate('document.documentElement.dataset.layoutId')!=page.evaluate('document.documentElement.dataset.layoutId')
    print('PASS '+engine+': beta channel is separate')

    assert not errors, errors
    browser.close()
server.shutdown()
