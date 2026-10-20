"""Headless Chromium smoke tests. Uses inlined ES modules to avoid requiring a server."""
from pathlib import Path
from shutil import which
import json
import re
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text(encoding='utf-8')
layout=(root/'src/starter-layout.json').read_text(encoding='utf-8')
html=html.replace('__STARTER_DATA__',layout.replace('<','\\u003c'))
html=html.replace('<script src="/src/main.js" type="module"></script>','')
css=(root/'src/styles.css').read_text(encoding='utf-8')
html=html.replace('</head>','<style>'+css+'</style></head>')
parts=[]
for name in ['interactions','card-background','image-tools','layers','text-format','objects','files']:
    src=(root/('src/editor/'+name+'.js')).read_text(encoding='utf-8')
    parts.append(src.replace('export function ','function '))
core=(root/'src/editor.js').read_text(encoding='utf-8')
core=re.sub(r'^import .*?;\n','',core,flags=re.M)
parts.append(core)
html=html.replace('</body>','<script>'+'\n'.join(parts)+'</script></body>')

with sync_playwright() as p:
    args={'headless':True,'args':['--no-sandbox']}
    if which('chromium'): args['executable_path']=which('chromium')
    browser=p.chromium.launch(**args)
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate("""() => {const m=new Map(); Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}});}""")
    page.set_content(html,wait_until='load')
    assert page.locator('.el').count()==len(json.loads(layout)),errors
    print('PASS render layout')
    card=page.locator('.el.card').first
    item_id=card.get_attribute('data-id')
    title=card.locator('.title.editable')
    title.click()
    assert card.evaluate('(e)=>e.classList.contains("selected")')
    title.fill('Модульный тест')
    assert 'Модульный тест' in page.evaluate('localStorage.getItem("dnd-card-editor-v3")')
    print('PASS selection, editing and persistence')
    grip=card.locator('.text-grip').first
    grip.dispatch_event('pointerdown',{'button':0,'clientX':100,'clientY':100})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:135,clientY:120}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    saved=json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")'))
    assert next(x for x in saved if x['id']==item_id).get('textFrames')
    print('PASS text frame dragging')
    count=page.locator('.el').count()
    page.locator('#rect').click()
    assert page.locator('.el').count()==count+1
    assert page.locator('.el.selected.shape').count()==1
    page.locator('#delete').click()
    assert page.locator('.el').count()==count
    print('PASS adding/deleting shapes')
    page.locator('#add').click()
    page.locator('#duplicate').click()
    assert page.locator('.el').count()==count+2
    page.locator('#front').click()
    assert not errors,errors
    print('PASS card duplication/layer ordering')
    data=json.dumps(json.loads(layout)).encode()
    page.set_input_files('#import',{'name':'layout.json','mimeType':'application/json','buffer':data})
    assert page.locator('.el').count()==count
    assert not errors,errors
    print('PASS JSON import')
    browser.close()
print('All smoke checks passed')
