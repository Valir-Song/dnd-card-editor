"""Regression tests for 3.3.1 fixes, run against the ACTUAL Vite-built standalone HTML:
bad JSON import, damaged localStorage, storage quota, export hygiene, print outlines
and Moveable handle alignment after the page moves.
"""
import os
import re
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html_path=root/'dist'/'index.html'
assert html_path.exists(), 'Build the standalone HTML before running this test'
engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
KEY='dnd-card-editor-v3'
starter=json.loads((root/'src'/'starter-layout.json').read_text(encoding='utf-8'))

def open_editor(context,url=html_path.as_uri()):
    page=context.new_page()
    page.errors=[]
    page.dialogs=[]
    page.on('pageerror',lambda error:page.errors.append(str(error)))
    page.on('dialog',lambda dialog:(page.dialogs.append(dialog.message),dialog.accept()))
    page.goto(url,wait_until='load')
    page.wait_for_selector('.el .tiptap-content')
    return page

def import_json(page,data,name='layout.json'):
    page.locator('[data-tab="files"]').click()
    page.set_input_files('#import',{'name':name,'mimeType':'application/json',
      'buffer':json.dumps(data,ensure_ascii=False).encode('utf-8')})
    page.wait_for_timeout(300)

def stored(page):
    return page.evaluate(f"()=>localStorage.getItem('{KEY}')")

def handle_offset(page,element):
    """Distance in px between the element's bottom-right corner and Moveable's SE handle."""
    return page.evaluate("""e=>{
      const r=e.getBoundingClientRect();
      const h=[...document.querySelectorAll('.moveable-control-box .moveable-se')]
        .map(n=>n.getBoundingClientRect()).find(r=>r.width>0&&r.height>0);
      return Math.hypot(h.x+h.width/2-r.right,h.y+h.height/2-r.bottom)
    }""",element.element_handle())

with sync_playwright() as p:
    browser=getattr(p,engine).launch(headless=True,args=['--no-sandbox'] if engine=='chromium' else [])

    # 1. An undrawable import is rejected before it replaces the layout or reaches storage.
    context=browser.new_context()
    page=open_editor(context)
    page.locator('.el.card').first.click(position={'x':2,'y':2})
    page.keyboard.press('Delete')  # make storage differ from the template
    before_count=page.locator('.el').count()
    before_storage=stored(page)
    import_json(page,[{'id':'x','kind':'card','page':3,'x':0,'y':0,'w':10,'h':10,'title':'t'}])
    assert page.dialogs and 'страница 3' in page.dialogs[-1] and 'не изменён' in page.dialogs[-1],page.dialogs
    assert page.locator('.el').count()==before_count
    assert stored(page)==before_storage,'Rejected import must not touch localStorage'
    import_json(page,'not a layout')
    assert 'массив' in page.dialogs[-1],page.dialogs
    reload=open_editor(context)
    assert reload.locator('.el').count()==before_count and not reload.errors,reload.errors
    assert not page.errors,page.errors
    print('PASS '+engine+': invalid JSON import is rejected and leaves layout and storage intact')

    # 2. A damaged save falls back to the template, with a downloadable copy of the raw data.
    for damaged in ['{not json',json.dumps([{'id':'x','kind':'card','page':3,'x':0,'y':0,'w':10,'h':10}])]:
        page.evaluate("([k,v])=>localStorage.setItem(k,v)",[KEY,damaged])
        recovered=open_editor(context)
        assert not recovered.errors,recovered.errors
        assert recovered.locator('.el').count()==len(starter)
        notice=recovered.locator('.notice[data-notice="damaged"]')
        assert notice.is_visible(),'Damaged-save notice must be visible'
        assert recovered.evaluate(f"()=>localStorage.getItem('{KEY}-recovery')")==damaged
        assert recovered.locator('#undo').is_disabled(),'History must not offer to restore damaged data'
        with recovered.expect_download() as downloaded:
            notice.get_by_role('button',name='Скачать повреждённый JSON').click()
        assert Path(downloaded.value.path()).read_text(encoding='utf-8')==damaged
        recovered.close()
    context.close()
    print('PASS '+engine+': damaged localStorage opens the template and offers the raw copy')

    # 3. Storage quota failures are visible, honest on «Сохранить», and clear once saving works.
    context=browser.new_context()
    page=open_editor(context)
    big=starter+[{'id':'huge','kind':'image','page':1,'x':10,'y':10,'w':20,'h':20,'z':99,
                  'src':'data:image/png;base64,'+'A'*7_000_000}]
    import_json(page,big)
    notice=page.locator('.notice[data-notice="storage"]')
    assert notice.is_visible(),'Quota failure must be reported to the user'
    page.locator('#save').click()
    assert 'Не удалось' in page.dialogs[-1],page.dialogs
    notice.locator('.notice-close').click()
    page.locator('#save').click()
    assert notice.count()==0,'A dismissed notice must not reappear on every keystroke'
    page.locator('#undo').click()
    assert page.locator('.el[data-id="huge"]').count()==0
    assert '"huge"' not in stored(page)
    assert page.locator('.notice').count()==0
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': storage quota warning, honest save message and recovery')

    # 4. Repeated export generations stay clean and reopen with a single set of handles.
    context=browser.new_context(accept_downloads=True)
    url=html_path.as_uri()
    folder=Path(tempfile.mkdtemp(prefix='dnd-export-'))
    sizes=[]
    boxes=None  # one control box per Moveable instance; must not grow per generation
    for generation in range(3):
        page=open_editor(context,url)
        count=page.locator('.moveable-control-box').count()
        boxes=boxes if boxes is not None else count
        assert count==boxes,('Control boxes accumulate after re-export',generation,count,boxes)
        page.locator('[data-tab="files"]').click()
        with page.expect_download() as downloaded:
            page.locator('#export').click()
        exported=folder/f'generation{generation}.html'
        shutil.copy2(downloaded.value.path(),exported)
        text=exported.read_text(encoding='utf-8')
        # Library source mentions these names, so look for real markup only.
        for pattern in [r'<div[^>]+class="moveable-control-box',r'<div[^>]+class="selecto-selection',
                        r'<style[^>]+data-styled-id',r'<div[^>]+class="notice"']:
            assert not re.search(pattern,text),(generation,pattern)
        sizes.append(len(text))
        assert not page.errors,page.errors
        page.close()
        url=exported.as_uri()
    assert sizes[1]==sizes[2],('Export must be stable across generations',sizes)
    context.close()
    print('PASS '+engine+': exported HTML carries no runtime overlays across generations')

    # 5. Selection outlines and handles never print.
    context=browser.new_context()
    page=open_editor(context)
    card=page.locator('.page[data-page="1"] .el.card').nth(1)
    card.click(position={'x':2,'y':2})
    page.locator('.page[data-page="1"] .el.card').nth(2).click(position={'x':2,'y':2},modifiers=['Shift'])
    assert card.evaluate('e=>getComputedStyle(e).outlineStyle')=='dashed'
    page.emulate_media(media='print')
    assert card.evaluate('e=>getComputedStyle(e).outlineStyle')=='none','Selected outline leaks into print'
    assert page.evaluate("()=>[...document.querySelectorAll('.moveable-control-box,.selecto-selection,.toolbar')].every(e=>getComputedStyle(e).display==='none')")
    page.emulate_media(media='screen')
    print('PASS '+engine+': selection outlines, handles and toolbar are hidden in print')

    # 6. Handles follow the object when the window resizes or the narrow stage scrolls.
    page.locator('#page1').click(position={'x':4,'y':4})  # blank margin clears the group
    card.click(position={'x':2,'y':2})
    assert page.locator('.el.selected').count()==1
    assert handle_offset(page,card)<2
    page.set_viewport_size({'width':900,'height':800})
    page.wait_for_timeout(100)
    assert handle_offset(page,card)<2,'Handles stale after window resize'
    page.set_viewport_size({'width':600,'height':800})
    page.locator('.stage').evaluate('s=>{s.scrollLeft=150}')
    page.wait_for_timeout(100)
    assert page.locator('.stage').evaluate('s=>s.scrollLeft')>0,'Stage should scroll horizontally on narrow screens'
    assert handle_offset(page,card)<2,'Handles stale after stage scroll'
    # The nested text-frame Moveable must follow the same scroll.
    title=card.locator('.text-wrap[data-field="title"]')
    title.locator('.tiptap-content').click()
    assert handle_offset(page,title)<2
    page.locator('.stage').evaluate('s=>{s.scrollLeft=40}')
    page.wait_for_timeout(100)
    assert handle_offset(page,title)<2,'Nested text-frame handles stale after stage scroll'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': card and text-frame handles follow window resize and stage scrolling')

    # 7. Chrome shares one localStorage between all local files: the newer of
    #    "layout in this file" and "layout saved in the browser" must open,
    #    the other must stay reachable, and the reset button must work.
    context=browser.new_context(accept_downloads=True)
    page=open_editor(context)
    page.locator('#page2 .el.card').first.click(position={'x':2,'y':2})
    page.keyboard.press('Delete')                       # browser save: 27 objects
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as downloaded:
        page.locator('#export').click()
    exported=Path(tempfile.mkdtemp(prefix='dnd-fresh-'))/'export.html'
    shutil.copy2(downloaded.value.path(),exported)       # file: 27 objects, dated
    assert 'data-saved-at=' in exported.read_text(encoding='utf-8')
    page.close()

    same=open_editor(context,exported.as_uri())
    assert same.locator('.notice').count()==0,'Identical layouts must open without a notice'
    same.locator('#page2 .el.card').first.click(position={'x':2,'y':2})
    same.keyboard.press('Delete')                        # browser save is now newer: 26
    same.close()

    newer_browser=open_editor(context,exported.as_uri())
    assert newer_browser.locator('.el').count()==len(starter)-2
    notice=newer_browser.locator('.notice[data-notice="freshness"]')
    assert notice.is_visible() and 'новее макета в этом файле' in notice.inner_text()
    notice.get_by_role('button',name='Открыть макет из файла').click()
    assert newer_browser.locator('.el').count()==len(starter)-1
    assert newer_browser.locator('.notice').count()==0
    newer_browser.locator('#undo').click()
    assert newer_browser.locator('.el').count()==len(starter)-2,'Switching layouts must be undoable'
    newer_browser.close()

    page=context.new_page()
    page.goto(exported.as_uri()); page.wait_for_selector('.el .tiptap-content')
    page.evaluate(f"()=>localStorage.setItem('{KEY}-meta',JSON.stringify({{savedAt:'2000-01-01T00:00:00Z'}}))")
    page.close()
    newer_file=open_editor(context,exported.as_uri())
    assert newer_file.locator('.el').count()==len(starter)-1,'A newer file must win over an older save'
    notice=newer_file.locator('.notice[data-notice="freshness"]')
    assert 'он новее макета, сохранённого в браузере' in notice.inner_text()
    assert json.loads(newer_file.evaluate(f"()=>localStorage.getItem('{KEY}-previous')")).__len__()==len(starter)-2
    with newer_file.expect_download() as backup:
        notice.get_by_role('button',name='Скачать его JSON').click()
    assert len(json.loads(Path(backup.value.path()).read_text(encoding='utf-8')))==len(starter)-2
    notice.get_by_role('button',name='Открыть макет из браузера').click()
    assert newer_file.locator('.el').count()==len(starter)-2

    # Reset: back up, then show this file's layout; Ctrl+Z restores.
    newer_file.locator('[data-tab="files"]').click()
    with newer_file.expect_download() as backup:
        newer_file.locator('#resetStorage').click()
    assert newer_file.dialogs and 'Сбросить сохранение' in newer_file.dialogs[-1]
    assert len(json.loads(Path(backup.value.path()).read_text(encoding='utf-8')))==len(starter)-2
    assert newer_file.locator('.el').count()==len(starter)-1
    assert len(json.loads(stored(newer_file)))==len(starter)-1
    newer_file.keyboard.press('Control+z')
    assert newer_file.locator('.el').count()==len(starter)-2
    assert not newer_file.errors,newer_file.errors
    context.close()
    print('PASS '+engine+': newer of file and browser save opens; other one stays reachable; reset button')

    # 8. Press on an UNSELECTED object and drag in one motion: the whole
    #    distance must apply (3.3.x moved ~1 mm, then Moveable threw errors).
    context=browser.new_context()
    page=open_editor(context)
    page.evaluate("localStorage.setItem('dnd-card-editor-snap',JSON.stringify({enabled:false,gridMm:0}))")
    page.reload(); page.wait_for_selector('.el .tiptap-content')
    card=page.locator('#page1 .el.card').nth(3)
    card.scroll_into_view_if_needed()
    grab=card.evaluate("""card=>{const r=card.getBoundingClientRect();
      for(let y=r.bottom-6;y>r.top;y-=2)for(let x=r.left+6;x<r.right;x+=2){const t=document.elementFromPoint(x,y);
        if(t&&t.closest('.el')===card&&!t.closest('.text-wrap,.level,.editable'))return [x,y]}}""")
    assert grab,'No blank area to grab the card'
    before=card.bounding_box()
    page.mouse.move(*grab); page.mouse.down()
    page.mouse.move(grab[0]+40,grab[1]+30,steps=10); page.mouse.up()
    page.wait_for_timeout(100)
    after=card.bounding_box()
    assert abs(after['x']-before['x']-40)<1.5 and abs(after['y']-before['y']-30)<1.5,(before,after)
    assert not page.errors,page.errors
    context.close()
    # Input that outruns the deferred drag start (fast flick or a busy machine)
    # is replayed rather than lost; a plain click still moves nothing.
    context=browser.new_context()
    page=open_editor(context)
    page.evaluate("localStorage.setItem('dnd-card-editor-snap',JSON.stringify({enabled:false,gridMm:0}))")
    page.reload(); page.wait_for_selector('.page')
    import_json(page,[{'id':'b','kind':'shape','shape':'rect','page':1,'x':100,'y':100,'w':30,'h':20,'z':1}])
    k=page.locator('#page1').bounding_box()['width']/210
    burst="""([up,dist])=>{const el=document.querySelector('.el[data-id="b"]');const r=el.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2,o={bubbles:true,cancelable:true,button:0,buttons:1};
      el.dispatchEvent(new MouseEvent('mousedown',{...o,clientX:x,clientY:y}));
      if(dist)for(let i=1;i<=5;i++)document.dispatchEvent(new MouseEvent('mousemove',{...o,clientX:x+8*i,clientY:y+6*i}));
      if(up)document.dispatchEvent(new MouseEvent('mouseup',{...o,buttons:0,clientX:x+(dist?40:0),clientY:y+(dist?30:0)}));
      return [x,y]}"""
    shape=lambda:next(i for i in json.loads(stored(page)) if i['id']=='b')
    page.evaluate(burst,[True,True]); page.wait_for_timeout(150)
    assert abs(shape()['x']-100-40/k)<0.3,('Flick within one task was lost',shape())
    page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    page.locator('#page1').click(position={'x':4,'y':4})
    x,y=page.evaluate(burst,[False,True]); page.wait_for_timeout(150)   # drag started after the moves
    page.evaluate("([x,y])=>document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,buttons:0,clientX:x,clientY:y}))",[x+40,y+30])
    page.wait_for_timeout(150)
    assert abs(shape()['x']-100-40/k)<0.3,('Moves before drag start were lost',shape())
    page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    page.locator('#page1').click(position={'x':4,'y':4})
    page.evaluate(burst,[True,False]); page.wait_for_timeout(150)
    assert shape()['x']==100,('A plain click moved the object',shape())
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': one-motion drag of an unselected object moves the full distance')

    # 9. Snapping: a dragged object aligns with another object's edge, shows a
    #    guide, can be switched off or bypassed with Alt, and follows the grid.
    def snap_case(setup,modifier=None,dx_mm=0,dy_mm=0):
        context=browser.new_context()
        page=open_editor(context)
        page.evaluate("s=>localStorage.setItem('dnd-card-editor-snap',JSON.stringify(s))",setup)
        layout=[{'id':'a','kind':'shape','shape':'rect','page':1,'x':20,'y':20,'w':30,'h':20,'z':1},
                {'id':'b','kind':'shape','shape':'rect','page':1,'x':100,'y':100,'w':30,'h':20,'z':2}]
        page.reload(); page.wait_for_selector('.page')
        import_json(page,layout)
        node=page.locator('.el[data-id="b"]')
        node.scroll_into_view_if_needed()
        k=page.locator('#page1').bounding_box()['width']/210
        box=node.bounding_box(); x0,y0=box['x']+box['width']/2,box['y']+box['height']/2
        page.mouse.move(x0,y0); page.mouse.down()
        if modifier: page.keyboard.down(modifier)
        page.mouse.move(x0+dx_mm*k,y0+dy_mm*k,steps=12)
        guide=page.locator('#page1 > .snap-guide.x').count()
        page.mouse.up()
        if modifier: page.keyboard.up(modifier)
        page.wait_for_timeout(100)
        b=next(x for x in json.loads(stored(page)) if x['id']=='b')
        leftover=page.locator('.snap-guide').count()
        assert not page.errors,page.errors
        context.close()
        return b,guide,leftover
    b,guide,leftover=snap_case({'enabled':True,'gridMm':0},dx_mm=-79,dy_mm=-30)   # lands 1 mm right of a
    assert abs(b['x']-20)<1e-6 and guide==1 and leftover==0,(b,guide,leftover)
    b,_,_=snap_case({'enabled':False,'gridMm':0},dx_mm=-79,dy_mm=-30)
    assert abs(b['x']-21)<0.3,b
    b,_,_=snap_case({'enabled':True,'gridMm':0},modifier='Alt',dx_mm=-79,dy_mm=-30)
    assert abs(b['x']-21)<0.3,('Alt must bypass snapping',b)
    b,_,_=snap_case({'enabled':True,'gridMm':5},dx_mm=-17.3,dy_mm=13.6)            # far from other lines
    assert abs(b['x']%5)<1e-6 and abs(b['y']%5)<1e-6,('Grid not applied',b)
    # Resizing snaps the dragged edge only.
    context=browser.new_context()
    page=open_editor(context)
    import_json(page,[{'id':'a','kind':'shape','shape':'rect','page':1,'x':20,'y':20,'w':30,'h':20,'z':1},
                      {'id':'b','kind':'shape','shape':'rect','page':1,'x':20,'y':100,'w':40,'h':20,'z':2}])
    page.locator('.el[data-id="b"]').click(); page.wait_for_timeout(100)
    handle=page.locator('.moveable-control-box .moveable-e').first.bounding_box()
    k=page.locator('#page1').bounding_box()['width']/210
    hx,hy=handle['x']+handle['width']/2,handle['y']+handle['height']/2
    page.mouse.move(hx,hy); page.mouse.down(); page.mouse.move(hx-9*k,hy,steps=10); page.mouse.up()
    page.wait_for_timeout(100)
    b=next(x for x in json.loads(stored(page)) if x['id']=='b')
    assert abs(b['x']-20)<1e-6 and abs(b['x']+b['w']-50)<1e-6,('Resized edge did not snap',b)
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': snapping aligns to objects with a guide; off switch, Alt and grid work')

    browser.close()
print('All 3.3.1 regression checks passed for '+engine)
