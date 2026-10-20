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
for name in ['history','interactions','card-background','image-tools','layers','text-format','objects','files']:
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
    assert page.locator('#undo').is_disabled() and page.locator('#redo').is_disabled()
    print('PASS render layout, history initially empty')
    card=page.locator('.el.card').first
    item_id=card.get_attribute('data-id')
    title=card.locator('.title.editable')
    title.click()
    assert card.evaluate('(e)=>e.classList.contains("selected")')
    title.fill('Модульный тест')
    assert 'Модульный тест' in page.evaluate('localStorage.getItem("dnd-card-editor-v3")')
    assert page.locator('#undo').is_enabled()
    page.keyboard.press('Control+z')
    assert card.locator('.title').inner_text()!='Модульный тест'
    assert page.locator('#redo').is_enabled()
    page.keyboard.press('Control+Shift+z')
    assert card.locator('.title').inner_text()=='Модульный тест'
    print('PASS selection, editing, persistence and keyboard undo/redo')
    card.locator('.title').click()
    grip=card.locator('.text-grip').first
    grip.dispatch_event('pointerdown',{'button':0,'clientX':100,'clientY':100})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:135,clientY:120}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    saved=json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")'))
    assert next(x for x in saved if x['id']==item_id).get('textFrames')
    page.locator('#undo').click()
    undone=json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")'))
    assert not next(x for x in undone if x['id']==item_id).get('textFrames'), 'Text frame undo failed'
    page.locator('#redo').click()
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id).get('textFrames')
    print('PASS text frame drag with undo/redo')
    # Whole-card movement and resizing each need an independent history step.
    original=next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)
    x0,w0=original['x'],original['w']
    card.dispatch_event('pointerdown',{'button':0,'clientX':130,'clientY':130})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:150,clientY:130}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    moved=next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)
    assert moved['x']!=x0
    page.locator('#undo').click()
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['x']==x0
    page.locator('#redo').click()
    card.locator('.resize').dispatch_event('pointerdown',{'button':0,'clientX':130,'clientY':130})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:165,clientY:130}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    resized=next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)
    assert resized['w']!=w0
    page.locator('#undo').click()
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']==w0
    page.locator('#redo').click()
    page.locator('#bg').focus()
    page.keyboard.press('Control+z')
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']==w0, 'Ctrl+Z with toolbar focus'
    page.keyboard.press('Control+y')
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']!=w0, 'Ctrl+Y with toolbar focus'
    card.locator('.title.editable').focus()
    page.keyboard.press('Control+z')
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']==w0, 'Ctrl+Z with card text focus'
    page.keyboard.press('Control+Shift+z')
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']!=w0, 'Ctrl+Shift+Z with card text focus'
    print('PASS keyboard history when inputs and card text retain focus')

    # Simulate a Russian keyboard layout. On the same physical keys, event.key
    # is Cyrillic 'я'/'н'; relying only on the Latin character misses Undo/Redo.
    page.locator('.level').first.focus()
    def localized_hotkey(key,code,shift=False):
        return page.evaluate("""args=>{
            const event=new KeyboardEvent('keydown',{
                key:args[0],code:args[1],ctrlKey:true,shiftKey:args[2],
                bubbles:true,cancelable:true
            });
            document.activeElement.dispatchEvent(event);
            return event.defaultPrevented;
        }""",[key,code,shift])
    assert localized_hotkey('я','KeyZ'), 'Russian Ctrl+Z shortcut was not handled'
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']==w0
    assert localized_hotkey('н','KeyY'), 'Russian Ctrl+Y shortcut was not handled'
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']!=w0
    assert localized_hotkey('Я','KeyZ',True), 'Russian Ctrl+Shift+Z shortcut was not handled'
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']!=w0
    print('PASS shortcuts with Cyrillic keyboard layout and focused level badge')

    print('PASS card movement/resize undo/redo')
    count=page.locator('.el').count()
    page.locator('#rect').click()
    assert page.locator('.el').count()==count+1
    assert page.locator('.el.selected.shape').count()==1
    page.locator('#delete').click()
    assert page.locator('.el').count()==count
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Delete undo failed'
    page.locator('#redo').click()
    assert page.locator('.el').count()==count, 'Delete redo failed'
    print('PASS shape creation/deletion with undo/redo')
    page.locator('#add').click()
    page.locator('#duplicate').click()
    assert page.locator('.el').count()==count+2
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Layer undo or duplicate undo failed'
    page.locator('#rect').click()
    assert page.locator('#redo').is_disabled(), 'New edit after undo must clear redo'
    page.locator('#undo').click()
    page.locator('#front').click()
    assert not errors, errors
    page.locator('#front').click()
    assert not errors, errors
    print('PASS card duplication, layers and redo invalidation')
    data=json.dumps(json.loads(layout)).encode()
    page.set_input_files('#import',{'name':'layout.json','mimeType':'application/json','buffer':data})
    assert page.locator('.el').count()==count
    assert not errors,errors
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Import undo failed'
    page.locator('#redo').click()
    assert page.locator('.el').count()==count
    print('PASS JSON import undo/redo')
    browser.close()
print('All smoke checks passed')
