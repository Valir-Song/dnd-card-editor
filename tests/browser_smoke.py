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
for name in ['history','interactions','card-background','image-tools','layers','text-format','objects','files','toolbar-tabs','text-boxes']:
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
    assert page.locator('[role="tab"]').count()==6
    assert page.locator('#panel-cards').is_visible() and page.locator('#panel-files').is_hidden()
    page.locator('[data-tab="appearance"]').click()
    assert page.locator('#panel-appearance').is_visible() and page.locator('#panel-cards').is_hidden()
    page.locator('[data-tab="cards"]').click()
    print('PASS accessible toolbar tabs and panel switching')

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

    # Select just one word in a card. Exact point sizes must not affect the rest.
    page.locator('[data-tab="text"]').click()
    title.evaluate("""e=>{
        const text=e.firstChild,r=document.createRange(),sel=window.getSelection();
        r.setStart(text,0);r.setEnd(text,'Модульный'.length);
        sel.removeAllRanges();sel.addRange(r)
    }""")
    page.wait_for_timeout(40)
    page.locator('#fontSize').fill('17')
    assert 'font-size: 17pt' in title.inner_html(),title.inner_html()
    assert title.inner_text()=='Модульный тест'
    assert 'font-size: 17pt' in page.evaluate('localStorage.getItem("dnd-card-editor-v3")')
    page.locator('#undo').click()
    assert title.inner_html()=='Модульный тест','One undo must completely revert selected text formatting'
    page.locator('#redo').click()
    assert 'font-size: 17pt' in title.inner_html(),'Redo selected text formatting'
    # Exact size persists through save/load and doesn't format the unselected word.
    assert title.locator('span[style*="font-size: 17pt"]').first.inner_text()=='Модульный'
    assert 'тест' in title.inner_text()
    title.evaluate("""e=>{
        const word=e.querySelector('span[style*=font-size]').firstChild,r=document.createRange(),sel=window.getSelection();
        r.selectNodeContents(word);sel.removeAllRanges();sel.addRange(r)
    }""")
    page.wait_for_timeout(40)
    page.locator('#fontFamily').select_option('Arial')
    assert title.locator('span[style*="font-family: Arial"]').count()>=1,'Font family should affect highlighted word'
    assert title.inner_text()=='Модульный тест'
    page.locator('#undo').click()
    assert title.locator('span[style*="font-family: Arial"]').count()==0,'Font family should undo in one step'
    page.locator('#redo').click()
    assert title.locator('span[style*="font-family: Arial"]').count()>=1


    # Real pointer/keyboard operations, not manually dispatched 'change' events:
    # spinner and keyboard edits must continue to target the same word.
    title.evaluate("""e=>{
        const word=e.querySelector('span[style*=font-family]')?.firstChild||e.querySelector('span[style*=font-size]')?.firstChild;
        const r=document.createRange(),s=getSelection();
        r.selectNodeContents(word);s.removeAllRanges();s.addRange(r)
    }""")
    page.wait_for_timeout(40)
    assert page.locator('#fontSize').input_value()=='17'
    page.locator('#fontSize').click()
    page.keyboard.press('ArrowUp')
    assert 'font-size: 18pt' in title.inner_html(),'Spinner ArrowUp must change highlighted text to 18pt'
    page.keyboard.press('ArrowUp')
    assert 'font-size: 19pt' in title.inner_html(),'Repeated spinner change must target same word'
    assert page.evaluate('document.activeElement.id')=='fontSize','Size field should retain focus after arrow'
    assert page.locator('#fontSize').input_value()=='19'
    page.locator('#fontSize').fill('23')
    assert 'font-size: 23pt' in title.inner_html(),'Manual number entry must change highlighted text'
    assert title.inner_text()=='Модульный тест'
    print('PASS spinner arrows and manual font-size entry on selected card word')

    title.click()
    page.locator('#textAlign').select_option('right')
    saved=json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")'))
    assert next(i for i in saved if i['id']==item_id)['textStyles']['title']['textAlign']=='right'
    print('PASS shared typography: precise 17pt word formatting and block alignment')

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
    page.locator('[data-tab="appearance"]').click(); page.locator('#bg').focus()
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
    assert localized_hotkey('я','KeyZ'), 'Russian Ctrl+Z before redo was not handled'
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']==w0
    assert localized_hotkey('Я','KeyZ',True), 'Russian Ctrl+Shift+Z shortcut was not handled'
    assert next(x for x in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if x['id']==item_id)['w']!=w0
    print('PASS shortcuts with Cyrillic keyboard layout and focused level badge')

    print('PASS card movement/resize undo/redo')
    count=page.locator('.el').count()
    page.locator('[data-tab="figures"]').click(); page.locator('#rect').click()
    assert page.locator('.el').count()==count+1
    assert page.locator('.el.selected.shape').count()==1
    page.locator('[data-tab="cards"]').click(); page.locator('#delete').click()
    assert page.locator('.el').count()==count
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Delete undo failed'
    page.locator('#redo').click()
    assert page.locator('.el').count()==count, 'Delete redo failed'
    print('PASS shape creation/deletion with undo/redo')
    page.locator('[data-tab="cards"]').click(); page.locator('#add').click()
    page.locator('[data-tab="cards"]').click(); page.locator('#duplicate').click()
    assert page.locator('.el').count()==count+2
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Layer undo or duplicate undo failed'
    page.locator('[data-tab="figures"]').click(); page.locator('#rect').click()
    assert page.locator('#redo').is_disabled(), 'New edit after undo must clear redo'
    page.locator('#undo').click()
    page.locator('[data-tab="layers"]').click(); page.locator('#front').click()
    assert not errors, errors
    page.locator('[data-tab="layers"]').click(); page.locator('#front').click()
    assert not errors, errors
    print('PASS card duplication, layers and redo invalidation')
    data=json.dumps(json.loads(layout)).encode()
    page.locator('[data-tab="files"]').click()
    page.set_input_files('#import',{'name':'layout.json','mimeType':'application/json','buffer':data})
    page.wait_for_function(f'document.querySelectorAll(".el").length === {count}')
    assert not errors,errors
    page.locator('#undo').click()
    assert page.locator('.el').count()==count+1, 'Import undo failed'
    page.locator('#redo').click()
    assert page.locator('.el').count()==count
    print('PASS JSON import undo/redo')

    # A text box is independent of cards and participates in history and layout.
    page.locator('[data-tab="text"]').click()
    page.locator('#addTextBox').click()
    box=page.locator('.el.textbox').last
    assert box.count()==1 and box.locator('.textbox-editor').count()==1
    text_id=box.get_attribute('data-id')
    assert page.locator('#fontFamily').is_visible()
    editor=box.locator('.textbox-editor')
    editor.dblclick()
    assert editor.get_attribute('contenteditable')=='true'
    editor.fill('Заметка для барда\\nДополнительная строка')
    assert 'Заметка для барда' in page.evaluate('localStorage.getItem("dnd-card-editor-v3")')
    page.keyboard.press('Control+z')
    assert 'Заметка для барда' not in box.locator('.textbox-editor').inner_text()
    assert box.locator('.textbox-editor').get_attribute('contenteditable')=='true'
    page.keyboard.press('Control+Shift+z')
    assert 'Заметка для барда' in box.locator('.textbox-editor').inner_text()
    page.locator('#fontFamily').select_option('Arial')
    page.locator('#fontSize').fill('16')
    page.locator('#textAlign').select_option('center')
    page.locator('#boxBorderVisible').check()
    page.locator('#boxTransparent').uncheck()
    page.locator('#boxAutoHeight').check()
    saved=json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")'))
    textbox=next(i for i in saved if i['id']==text_id)
    assert textbox['textAlign']=='center' and textbox['fontSize']==16
    assert textbox['fontFamily']=='Arial', 'The unified font picker must format text boxes'
    # Reselect the same box: the shared size control must reflect its real value.
    page.locator('.el.card').first.locator('.title.editable').click()
    editor.click()
    assert page.locator('#fontSize').input_value()=='16','Reselecting a textbox reset font size to 12'
    assert abs(float(editor.evaluate('e=>getComputedStyle(e).fontSize').replace('px',''))-(16*4/3))<1
    assert textbox['borderVisible'] and not textbox['bgTransparent'] and textbox['autoHeight']
    assert box.evaluate('e=>e.getBoundingClientRect().height')>=20
    grip=box.locator('.textbox-move')
    old_x=textbox['x']
    grip.dispatch_event('pointerdown',{'button':0,'clientX':110,'clientY':110})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:150,clientY:110}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    moved=next(i for i in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if i['id']==text_id)
    assert moved['x']!=old_x,'Text box movement failed'
    page.locator('#undo').click()
    assert next(i for i in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if i['id']==text_id)['x']==old_x
    page.locator('#redo').click()
    box.locator('.resize').dispatch_event('pointerdown',{'button':0,'clientX':150,'clientY':150})
    page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{clientX:190,clientY:180}))")
    page.evaluate("window.dispatchEvent(new PointerEvent('pointerup'))")
    resized=next(i for i in json.loads(page.evaluate('localStorage.getItem("dnd-card-editor-v3")')) if i['id']==text_id)
    assert not resized['autoHeight'] and resized['w']!=textbox['w']
    page.locator('[data-tab="layers"]').click()
    page.locator('#front').click()
    assert not errors,errors
    page.locator('#undo').click()
    page.locator('#redo').click()
    print('PASS independent textbox edit, style, drag, resize, layers and history')

    # Exporting an edited HTML page must rebuild working tab listeners on reopening.
    page.locator('[data-tab="files"]').click()
    page.evaluate("""() => {
      URL.createObjectURL=blob=>{window.__exportBlob=blob;return 'blob:mock'};
      HTMLAnchorElement.prototype.click=function(){window.__exportName=this.download}
    }""")
    page.locator('#export').click()
    assert page.evaluate('window.__exportName')=='DND_Card_Editor_3_2.html',errors
    exported=page.evaluate('async()=>window.__exportBlob.text()')
    assert 'data-tabs-ready="true"' not in exported.split('class="toolbar"',1)[1].split('>',1)[0]
    reopened=browser.new_page()
    reopened_errors=[]
    reopened.on('pageerror',lambda error:reopened_errors.append(str(error)))
    reopened.evaluate("""() => {const m=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)}})}""")
    reopened.set_content(exported,wait_until='load')
    assert reopened.locator('[role="tab"]').count()==6,reopened_errors
    reopened.locator('[data-tab="appearance"]').click()
    assert reopened.locator('#bg').is_visible()
    reopened.locator('[data-tab="files"]').click()
    assert reopened.locator('#print').is_visible()
    assert reopened.locator('.el.textbox').count()==1
    assert 'Заметка для барда' in reopened.locator('.el.textbox').inner_text()
    assert not reopened_errors,reopened_errors
    reopened.close()
    print('PASS standalone HTML export and reopened tab listeners')
    browser.close()
print('All smoke checks passed')
