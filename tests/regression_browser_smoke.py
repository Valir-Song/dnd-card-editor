"""Regression tests against the ACTUAL Vite-built standalone HTML:
bad JSON import, damaged localStorage, storage quota, export hygiene, print outlines
and gesture-handle alignment after the page moves.
"""
import os
import re
import base64
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_env import launch, saved_record, saved_layout, put_saved, remove_saved

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
    # Autosave writes in the background; a write still running when the page closes
    # can land after the next test step and overwrite what it prepared.
    close=page.close
    def close_when_saved(**options):
        try: wait_saved(page)
        except Exception: pass  # page already gone or never saved
        close(**options)
    page.close=close_when_saved
    return page

def import_json(page,data,name='layout.json'):
    page.locator('[data-tab="files"]').click()
    page.set_input_files('#import',{'name':name,'mimeType':'application/json',
      'buffer':json.dumps(data,ensure_ascii=False).encode('utf-8')})
    page.wait_for_timeout(300)

def stored(page):
    """The saved layout as JSON text (waits for autosave to finish)."""
    return json.dumps(saved_layout(page),ensure_ascii=False)

def wait_saved(page):
    """Autosave writes in the background: let it finish before closing a page
    (a real browser asks «leave the page?» while it runs; page.close() does not)."""
    page.wait_for_function("document.documentElement.dataset.saveState!=='saving'")

def leaving_blocked(page):
    """Would the page ask «leave the page?» now (its beforeunload handler cancels)?"""
    return page.evaluate("()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}")

def wait_dialog(page,count):
    """Message of the next alert/confirm after `count` seen so far (some appear after an async save)."""
    for _ in range(200):
        if len(page.dialogs)>count: return page.dialogs[-1]
        page.wait_for_timeout(25)
    raise AssertionError('No dialog appeared')

compact=lambda data:json.dumps(data,ensure_ascii=False,separators=(',',':'))  # = JSON.stringify
# Saves go to IndexedDB; ?storage=local forces the localStorage fallback, so the
# storage checks run against both.
BACKENDS=[('indexeddb',''),('localstorage','?storage=local')]
# IndexedDB has no practical quota here: simulate a full disk for one layout.
FAIL_HUGE_SAVES="""(()=>{const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...rest){
    if(this.name==='layouts'&&JSON.stringify(value).includes('"huge"'))throw new DOMException('Simulated full disk','QuotaExceededError');
    return put.call(this,value,...rest)}})()"""

def handle_offset(page,element):
    """Distance in px between the element's bottom-right corner and the selection frame's SE handle.
    Handles may be drawn on a later frame, so wait for a visible one and let two
    animation frames pass before measuring (slow CI runners need it)."""
    page.wait_for_function("""()=>[...document.querySelectorAll('.gesture-frame:not([hidden]) [data-dir="se"], .gesture-frame.inner:not([hidden]) [data-dir="se"]')]
      .some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0})""",timeout=5000)
    page.evaluate("()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    return page.evaluate("""e=>{
      const r=e.getBoundingClientRect();
      const h=[...document.querySelectorAll('.gesture-frame:not([hidden]) [data-dir="se"], .gesture-frame.inner:not([hidden]) [data-dir="se"]')]
        .map(n=>n.getBoundingClientRect()).find(r=>r.width>0&&r.height>0);
      return Math.hypot(h.x+h.width/2-r.right,h.y+h.height/2-r.bottom)
    }""",element.element_handle())

with sync_playwright() as p:
    browser=launch(p)

    # Which storage does this browser give a file opened from disk? If it refuses
    # IndexedDB the editor rightly falls back to localStorage: check that path only.
    probe_context=browser.new_context()
    native=open_editor(probe_context).evaluate('document.documentElement.dataset.storage')
    probe_context.close()
    backends=[b for b in BACKENDS if b[0]=='localstorage' or native=='indexeddb']
    print('NOTE '+engine+': storage for local files is '+native+('' if native=='indexeddb' else '; checking the localStorage fallback only'))

    for kind,query in backends:
        url=html_path.as_uri()+query
        # 1. An undrawable import is rejected before it replaces the layout or reaches storage.
        context=browser.new_context()
        page=open_editor(context,url)
        assert page.evaluate('document.documentElement.dataset.storage')==kind
        page.locator('.el.card').first.click(position={'x':2,'y':2})
        page.keyboard.press('Delete')  # make storage differ from the template
        before_count=page.locator('.el').count()
        before_storage=stored(page)
        assert len(json.loads(before_storage))==before_count
        import_json(page,[{'id':'x','kind':'card','page':3,'x':0,'y':0,'w':10,'h':10,'title':'t'}])
        assert page.dialogs and 'страница 3' in page.dialogs[-1] and 'не изменён' in page.dialogs[-1],page.dialogs
        assert page.locator('.el').count()==before_count
        assert stored(page)==before_storage,'Rejected import must not touch the saved layout'
        import_json(page,'not a layout')
        assert 'массив' in page.dialogs[-1],page.dialogs
        reload=open_editor(context,url)
        assert reload.locator('.el').count()==before_count and not reload.errors,reload.errors
        assert not page.errors,page.errors
        print('PASS '+engine+'/'+kind+': invalid JSON import is rejected and leaves layout and storage intact')

        # 2. A damaged save falls back to the template, with a downloadable copy of the raw
        #    data: a save of an editor up to 3.8 (localStorage) and one in the current storage.
        bad=[{'id':'x','kind':'card','page':3,'x':0,'y':0,'w':10,'h':10}]
        cases=[('legacy','{not json'),('legacy',compact(bad)),('current',compact(bad))]
        if kind=='localstorage': cases.append(('current','{not json'))
        for where,damaged in cases:
            remove_saved(page)
            # The old save is moved once (marked by KEY-moved); start each case afresh.
            page.evaluate("k=>{localStorage.removeItem(k);localStorage.removeItem(k+'-moved')}",KEY)
            if where=='legacy': page.evaluate("([k,v])=>localStorage.setItem(k,v)",[KEY,damaged])
            else: put_saved(page,{'id':page.evaluate('document.documentElement.dataset.layoutId'),'name':'','savedAt':'2026-01-01T00:00:00Z',
                                  'items':damaged if damaged.startswith('{') else json.loads(damaged)})
            recovered=open_editor(context,url)
            assert not recovered.errors,recovered.errors
            assert recovered.locator('.el').count()==len(starter)
            notice=recovered.locator('.notice[data-notice="damaged"]')
            assert notice.is_visible(),('Damaged-save notice must be visible',where,damaged)
            assert recovered.evaluate(f"()=>localStorage.getItem('{KEY}-recovery')")==damaged
            assert recovered.locator('#undo').is_disabled(),'History must not offer to restore damaged data'
            with recovered.expect_download() as downloaded:
                notice.get_by_role('button',name='Скачать повреждённый JSON').click()
            assert Path(downloaded.value.path()).read_text(encoding='utf-8')==damaged
            recovered.close()
        page.evaluate("k=>localStorage.removeItem(k)",KEY)
        context.close()
        print('PASS '+engine+'/'+kind+': a damaged save opens the template and offers the raw copy')

        # 2b. The save of an editor up to 3.8 opens once, moves into the current storage
        #     and stays in localStorage for older editor files.
        context=browser.new_context()
        page=open_editor(context,url)
        old=[{'id':'a','kind':'card','page':1,'x':10,'y':10,'w':60,'h':20,'z':1,'title':'Старый'},
             {'id':'b','kind':'shape','shape':'rect','page':1,'x':10,'y':40,'w':20,'h':20,'z':2}]
        page.evaluate("([k,v])=>{localStorage.setItem(k,v);localStorage.setItem(k+'-meta',JSON.stringify({savedAt:'2026-10-01T10:00:00Z'}))}",[KEY,compact(old)])
        page.close()
        moved=open_editor(context,url)
        assert moved.locator('.el').count()==2
        assert [i['id'] for i in saved_layout(moved)]==['a','b'],'The old save must move into the current storage'
        assert moved.evaluate(f"()=>localStorage.getItem('{KEY}')")==compact(old),'The old save must stay for older editors'
        moved.locator('.el[data-id="b"]').click(); moved.keyboard.press('Delete')
        assert [i['id'] for i in saved_layout(moved)]==['a']
        again=open_editor(context,url)
        assert again.locator('.el').count()==1,'Once moved, the old save must not come back'
        assert not moved.errors and not again.errors,(moved.errors,again.errors)
        context.close()
        print('PASS '+engine+'/'+kind+': the save of an older editor moves into the current storage once')

        big=starter+[{'id':'huge','kind':'image','page':1,'x':10,'y':10,'w':20,'h':20,'z':99,
                      'src':'data:image/png;base64,'+'A'*7_000_000}]
        if kind=='indexeddb':
            # 3a. The point of IndexedDB: a 7 MB layout, far over the old ~5 MB
            #     localStorage limit, is saved and opens again.
            context=browser.new_context()
            page=open_editor(context,url)
            import_json(page,big)
            page.wait_for_function("document.documentElement.dataset.saveState==='saved'")
            assert page.locator('.notice[data-notice="storage"]').count()==0,'A 7 MB layout must fit'
            assert any(i['id']=='huge' for i in saved_layout(page))
            again=open_editor(context,url)
            assert again.locator('.el[data-id="huge"]').count()==1,'The large layout must open again'
            assert not page.errors and not again.errors,(page.errors,again.errors)
            assert not leaving_blocked(again),'A saved layout must close without asking'
            context.close()
            print('PASS '+engine+'/'+kind+': a 7 MB layout is saved and reopens')

        # 3. Storage failures (a full quota) are visible, honest on «Сохранить», and clear once saving works.
        context=browser.new_context()
        if kind=='indexeddb': context.add_init_script(FAIL_HUGE_SAVES)
        page=open_editor(context,url)
        import_json(page,big)
        page.wait_for_function("document.documentElement.dataset.saveState==='error'")
        notice=page.locator('.notice[data-notice="storage"]')
        assert notice.is_visible(),'A failed save must be reported to the user'
        assert 'не помещается' in notice.inner_text()
        assert 'Не сохранено' in page.locator('#saveState').inner_text()
        seen=len(page.dialogs)
        page.locator('#save').click()
        assert 'Не удалось' in wait_dialog(page,seen),page.dialogs
        notice.locator('.notice-close').click()
        seen=len(page.dialogs)
        page.locator('#save').click()
        wait_dialog(page,seen)
        assert notice.count()==0,'A dismissed notice must not reappear on every keystroke'
        page.locator('#undo').click()
        assert page.locator('.el[data-id="huge"]').count()==0
        assert all(i['id']!='huge' for i in saved_layout(page))
        assert page.evaluate("document.documentElement.dataset.saveState")=='saved'
        assert 'Сохранено' in page.locator('#saveState').inner_text()
        assert page.locator('.notice').count()==0
        assert not page.errors,page.errors
        # With unsaved changes the browser asks before the tab closes.
        assert not leaving_blocked(page),'Everything is saved: closing must not ask'
        import_json(page,big)
        page.wait_for_function("document.documentElement.dataset.saveState==='error'")
        assert leaving_blocked(page),'Closing with unsaved changes must ask first'
        context.close()
        print('PASS '+engine+'/'+kind+': storage failure warning, honest save message, recovery, leave-page guard')

    # 4. Repeated export generations stay clean and reopen with a single set of handles.
    context=browser.new_context(accept_downloads=True)
    url=html_path.as_uri()
    folder=Path(tempfile.mkdtemp(prefix='dnd-export-'))
    sizes=[]
    boxes=None  # one gesture layer per page; must not grow per generation
    for generation in range(3):
        page=open_editor(context,url)
        count=page.locator('.gesture-layer').count()
        boxes=boxes if boxes is not None else count
        assert count==boxes,('Control boxes accumulate after re-export',generation,count,boxes)
        page.locator('[data-tab="files"]').click()
        with page.expect_download() as downloaded:
            page.locator('#export').click()
        exported=folder/f'generation{generation}.html'
        shutil.copy2(downloaded.value.path(),exported)
        text=exported.read_text(encoding='utf-8')
        # Library source mentions these names, so look for real markup only.
        for pattern in [r'<div[^>]+class="gesture-layer',
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
    assert page.evaluate("()=>[...document.querySelectorAll('.gesture-layer,.toolbar')].every(e=>getComputedStyle(e).display==='none')")
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
    # The text-frame handles must follow the same scroll.
    title=card.locator('.text-wrap[data-field="title"]')
    title.locator('.tiptap-content').click()
    assert handle_offset(page,title)<2
    page.locator('.stage').evaluate('s=>{s.scrollLeft=40}')
    page.wait_for_timeout(100)
    assert handle_offset(page,title)<2,'Nested text-frame handles stale after stage scroll'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': card and text-frame handles follow window resize and stage scrolling')

    # 7. Chrome shares browser storage between all local files: the newer of
    #    "layout in this file" and "layout saved in the browser" must open,
    #    the other must stay reachable, and the reset button must work.
    for kind,query in backends:
      context=browser.new_context(accept_downloads=True)
      page=open_editor(context,html_path.as_uri()+query)
      page.locator('#page2 .el.card').first.click(position={'x':2,'y':2})
      page.keyboard.press('Delete')                       # browser save: 27 objects
      page.locator('[data-tab="files"]').click()
      with page.expect_download() as downloaded:
          page.locator('#export').click()
      exported=Path(tempfile.mkdtemp(prefix='dnd-fresh-'))/'export.html'
      shutil.copy2(downloaded.value.path(),exported)       # file: 27 objects, dated
      assert 'data-saved-at=' in exported.read_text(encoding='utf-8')
      wait_saved(page); page.close()

      same=open_editor(context,exported.as_uri()+query)
      assert same.locator('.notice').count()==0,'Identical layouts must open without a notice'
      same.locator('#page2 .el.card').first.click(position={'x':2,'y':2})
      same.keyboard.press('Delete')                        # browser save is now newer: 26
      wait_saved(same); same.close()

      newer_browser=open_editor(context,exported.as_uri()+query)
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
      page.goto(exported.as_uri()+query); page.wait_for_selector('.el .tiptap-content')
      record=saved_record(page); record['savedAt']='2000-01-01T00:00:00Z'; put_saved(page,record)
      page.close()
      newer_file=open_editor(context,exported.as_uri()+query)
      assert newer_file.locator('.el').count()==len(starter)-1,'A newer file must win over an older save'
      notice=newer_file.locator('.notice[data-notice="freshness"]')
      assert 'он новее макета, сохранённого в браузере' in notice.inner_text()
      assert len(saved_layout(newer_file,newer_file.evaluate('document.documentElement.dataset.layoutId')+':previous'))==len(starter)-2,'The older browser save must be kept'
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
      print('PASS '+engine+'/'+kind+': newer of file and browser save opens; other one stays reachable; reset button')

    # 8. Press on an UNSELECTED object and drag in one motion: the whole
    #    distance must apply (3.3.x with Moveable moved ~1 mm, then threw errors).
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
      const x=r.left+r.width/2,y=r.top+r.height/2,o={bubbles:true,cancelable:true,button:0,buttons:1,pointerId:7,isPrimary:true,pointerType:'mouse'};
      el.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:x,clientY:y}));
      if(dist)for(let i=1;i<=5;i++)document.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:x+8*i,clientY:y+6*i}));
      if(up)document.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0,clientX:x+(dist?40:0),clientY:y+(dist?30:0)}));
      return [x,y]}"""
    shape=lambda:next(i for i in json.loads(stored(page)) if i['id']=='b')
    page.evaluate(burst,[True,True]); page.wait_for_timeout(150)
    assert abs(shape()['x']-100-40/k)<0.3,('Flick within one task was lost',shape())
    page.keyboard.press('Control+z'); page.wait_for_timeout(100)
    page.locator('#page1').click(position={'x':4,'y':4})
    x,y=page.evaluate(burst,[False,True]); page.wait_for_timeout(150)   # drag started after the moves
    page.evaluate("([x,y])=>document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,buttons:0,pointerId:7,isPrimary:true,pointerType:'mouse',clientX:x,clientY:y}))",[x+40,y+30])
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
    handle=page.locator('.gesture-frame:not([hidden]) [data-dir="e"]').first.bounding_box()
    k=page.locator('#page1').bounding_box()['width']/210
    hx,hy=handle['x']+handle['width']/2,handle['y']+handle['height']/2
    page.mouse.move(hx,hy); page.mouse.down(); page.mouse.move(hx-9*k,hy,steps=10); page.mouse.up()
    page.wait_for_timeout(100)
    b=next(x for x in json.loads(stored(page)) if x['id']=='b')
    assert abs(b['x']-20)<1e-6 and abs(b['x']+b['w']-50)<1e-6,('Resized edge did not snap',b)
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': snapping aligns to objects with a guide; off switch, Alt and grid work')

    # 10. Own gesture layer: edge-band drag, Shift keeps ratio, Shift+marquee
    #     adds to the selection, and touch input selects and drags.
    two_shapes=[{'id':'a','kind':'shape','shape':'rect','page':1,'x':20,'y':20,'w':40,'h':20,'z':1},
                {'id':'b','kind':'shape','shape':'rect','page':1,'x':120,'y':150,'w':30,'h':20,'z':2}]
    def shapes_page(**options):
        context=browser.new_context(**options)
        page=open_editor(context)
        page.evaluate("localStorage.setItem('dnd-card-editor-snap',JSON.stringify({enabled:false,gridMm:0}))")
        page.reload(); page.wait_for_selector('.page')
        import_json(page,two_shapes)
        return context,page
    context,page=shapes_page()
    k=page.locator('#page1').bounding_box()['width']/210
    item=lambda i:next(x for x in json.loads(stored(page)) if x['id']==i)
    page.locator('.el[data-id="a"]').click(); page.wait_for_timeout(50)
    band=page.locator('.gesture-frame:not([hidden]) .gesture-edge.top').bounding_box()
    bx,by=band['x']+band['width']*0.25,band['y']+band['height']/2  # away from the n handle
    page.mouse.move(bx,by); page.mouse.down(); page.mouse.move(bx+20*k,by+10*k,steps=8); page.mouse.up()
    assert abs(item('a')['x']-40)<0.3 and abs(item('a')['y']-30)<0.3,('Edge band did not drag',item('a'))
    se=page.locator('.gesture-frame:not([hidden]) [data-dir="se"]').bounding_box()
    sx,sy=se['x']+se['width']/2,se['y']+se['height']/2
    page.keyboard.down('Shift'); page.mouse.move(sx,sy); page.mouse.down()
    page.mouse.move(sx+40*k,sy+2*k,steps=8); page.mouse.up(); page.keyboard.up('Shift')
    a=item('a'); assert abs(a['w']/a['h']-2)<0.02 and a['w']>79,('Shift must keep the 2:1 ratio',a)
    page.locator('#page1').click(position={'x':4,'y':4})
    assert page.locator('.el.selected').count()==0
    page.locator('.el[data-id="a"]').click(); page.wait_for_timeout(50)
    p1=page.locator('#page1').bounding_box()
    x0,y0,x1,y1=p1['x']+110*k,p1['y']+140*k,p1['x']+160*k,p1['y']+180*k
    if engine=='firefox':
        # Under Playwright, Firefox delivers no further input to the page after
        # a Shift press on the blank sheet (recorded: pointerdown, mousedown,
        # one pointermove, then nothing), while Shift on handles works. Drive
        # the same gesture with Shift-flagged pointer events instead.
        page.evaluate("""([x0,y0,x1,y1])=>{const o={bubbles:true,cancelable:true,button:0,buttons:1,pointerId:9,
          isPrimary:true,pointerType:'mouse',shiftKey:true};const sheet=document.getElementById('page1');
          sheet.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:x0,clientY:y0}));
          for(let i=1;i<=6;i++)document.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:x0+(x1-x0)*i/6,clientY:y0+(y1-y0)*i/6}));
          document.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0,clientX:x1,clientY:y1}))}""",[x0,y0,x1,y1])
    else:
        page.keyboard.down('Shift')
        page.mouse.move(x0,y0); page.mouse.down()
        page.mouse.move(x1,y1,steps=6); page.mouse.up(); page.keyboard.up('Shift')
    page.wait_for_timeout(100)
    state=page.evaluate("""()=>({selected:[...document.querySelectorAll('.el.selected')].map(e=>e.dataset.id),
      count:document.getElementById('selectionCount').textContent,
      marqueeHidden:document.querySelector('.gesture-marquee').hidden})""")
    assert state['selected']==['a','b'] and state['count']=='Выбрано: 2',('Shift+marquee must add b to a',state)
    assert not page.errors,page.errors
    context.close()
    # Touch runs in its own context: Playwright's touch emulation in Firefox
    # changes how mouse input is delivered, and only Chromium drives touch drags.
    if engine=='chromium':
      context,page=shapes_page(has_touch=True)
      page.locator('.el[data-id="b"]').scroll_into_view_if_needed()
      shape_b=page.locator('.el[data-id="b"]').bounding_box()   # touch uses viewport coordinates
      page.touchscreen.tap(shape_b['x']+shape_b['width']/2,shape_b['y']+shape_b['height']/2)
      page.wait_for_timeout(100)
      assert page.locator('.el.selected').count()==1 and 'selected' in page.locator('.el[data-id="b"]').get_attribute('class'),'Tap must select'
      cdp=context.new_cdp_session(page)
      tx,ty=shape_b['x']+shape_b['width']/2,shape_b['y']+shape_b['height']/2
      cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':tx,'y':ty}]})
      for i in range(1,9): cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':tx-30*k*i/8,'y':ty-20*k*i/8}]})
      cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
      page.wait_for_timeout(150)
      assert abs(item('b')['x']-90)<0.5 and abs(item('b')['y']-130)<0.5,('Touch drag failed',item('b'))
      assert not page.errors,page.errors
      context.close()
    print('PASS '+engine+': edge-band drag, Shift ratio, Shift+marquee and touch on the gesture layer')

    # 11. Incremental rendering: changing one object keeps every other element
    #     (and its Tiptap editor) alive, and undo after direct style edits or
    #     gestures restores what is on screen, not only the data.
    context=browser.new_context()
    page=open_editor(context)
    page.evaluate("localStorage.setItem('dnd-card-editor-snap',JSON.stringify({enabled:false,gridMm:0}))")
    page.reload(); page.wait_for_selector('.page')
    import_json(page,[
      {'id':'c1','kind':'card','page':1,'x':10,'y':10,'w':90,'h':25,'z':1,'title':'Первая','meta':'м','detail':'д','titleHtml':'<p>Первая</p>'},
      {'id':'c2','kind':'card','page':1,'x':110,'y':10,'w':90,'h':25,'z':2,'title':'Вторая','meta':'м','detail':'д','titleHtml':'<p>Вторая</p>'},
      {'id':'im','kind':'image','page':1,'x':10,'y':60,'w':30,'h':30,'z':3,'src':'data:image/gif;base64,R0lGODlhAQABAAAAACw=','opacity':100}])
    tag="els=>els.forEach(e=>e.__keep=1)"
    page.locator('.el').evaluate_all(tag)
    page.locator('.tiptap-content').evaluate_all(tag)
    title=page.locator('.el[data-id="c1"] .title .tiptap-content')
    title.click(); page.keyboard.press('End'); page.keyboard.type(' +')
    # Add an object (a full draw()) while c1 is being edited.
    page.locator('[data-tab="figures"]').click(); page.locator('#rect').click()   # adds an object: draw()
    kept=page.evaluate("""()=>({els:[...document.querySelectorAll('.el')].filter(e=>e.__keep).map(e=>e.dataset.id),
      editors:[...document.querySelectorAll('.tiptap-content')].filter(e=>e.__keep).length,
      shapes:document.querySelectorAll('.el.shape').length})""")
    assert sorted(kept['els'])==['c1','c2','im'] and kept['editors']==6 and kept['shapes']==1,('Untouched elements were rebuilt',kept)
    assert 'Первая +' in title.inner_text()
    # Image sliders restyle the node directly; undo must restore the node too.
    page.locator('.el[data-id="im"]').click(); page.locator('[data-tab="appearance"]').click()
    page.locator('#opacity').fill('30'); page.locator('#opacity').dispatch_event('input')
    page.wait_for_timeout(1300)  # end the slider's undo group
    op=lambda:float(page.locator('.el[data-id="im"]').evaluate('e=>getComputedStyle(e).opacity'))
    assert abs(op()-0.3)<0.01
    page.keyboard.press('Escape'); page.locator('#undo').click()
    assert abs(op()-1)<0.01,('Undo left the slider style on screen',op())
    # Undo after a drag restores the on-screen position.
    card=page.locator('.el[data-id="c2"]')
    style=lambda:card.evaluate('e=>[e.style.left,e.style.top]')
    assert style()==['110mm','10mm'],style()
    grab=card.evaluate("""c=>{const r=c.getBoundingClientRect();for(let y=r.bottom-4;y>r.top;y-=2)for(let x=r.left+4;x<r.right;x+=2){const t=document.elementFromPoint(x,y);if(t&&t.closest('.el')===c&&!t.closest('.text-wrap,.level,.editable'))return [x,y]}}""")
    page.mouse.move(*grab); page.mouse.down(); page.mouse.move(grab[0]+30,grab[1]+40,steps=6); page.mouse.up()
    assert style()!=['110mm','10mm'],'Drag did not move the card'
    page.locator('#undo').click()
    # Compare the node's own position (the page may have scrolled during the drag).
    assert style()==['110mm','10mm'],('Undo left the dragged card in place',style())
    # Undo of typing restores the editor text from the data.
    for _ in range(10):
        if not page.locator('#undo').is_enabled(): break
        page.locator('#undo').click()
        if 'Первая +' not in title.inner_text(): break
    assert title.inner_text().strip()=='Первая',title.inner_text()
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': incremental rendering keeps untouched elements; undo restores screen state')

    # 12. Pictures: uploads are shrunk, transparency survives, the «Сжать картинки»
    #     button shrinks pictures already in the layout as one undo step, and undo
    #     keeps all its steps however large the pictures are (each is stored once).
    context=browser.new_context()
    page=open_editor(context)
    card=lambda i:{'id':'c'+str(i),'kind':'card','page':1,'x':10,'y':10+30*i,'w':90,'h':25,'z':i,'title':'К'+str(i),'meta':'м','detail':'д'}
    import_json(page,[card(1),card(2)])
    def picture(w,h,alpha=False):
        """A noisy PNG (large, like a photo); the left half transparent if asked."""
        return page.evaluate("""([w,h,alpha])=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),d=x.createImageData(w,h);
          for(let i=0;i<d.data.length;i+=4){const p=i/4,X=p%w,Y=p/w|0;const n=Math.random()*40;d.data[i]=X*215/w+n;d.data[i+1]=Y*215/h+n;d.data[i+2]=(X*Y)%216+n;d.data[i+3]=alpha&&X<w/2?0:255}
          x.putImageData(d,0,0);return c.toDataURL('image/png')}""",[w,h,alpha])
    png=lambda url:{'name':'photo.png','mimeType':'image/png','buffer':base64.b64decode(url.split(',')[1])}
    info=lambda sel:page.locator(sel).evaluate("""img=>new Promise(r=>{const probe=new Image();probe.onload=()=>{const c=document.createElement('canvas');c.width=probe.naturalWidth;c.height=probe.naturalHeight;
      const x=c.getContext('2d');x.drawImage(probe,0,0);r({src:img.src.slice(0,16),length:img.src.length,w:probe.naturalWidth,h:probe.naturalHeight,leftAlpha:x.getImageData(5,5,1,1).data[3]})};probe.src=img.src})""")
    big=picture(2400,1800)
    page.locator('[data-tab="figures"]').click()
    page.set_input_files('#upload',png(big))
    page.wait_for_selector('.el.image-el img')
    got=info('.el.image-el img')
    assert got['src'].startswith('data:image/jpeg') and max(got['w'],got['h'])==1600 and got['length']<len(big)/4,(got,len(big))
    clear=picture(800,600,alpha=True)
    page.set_input_files('#upload',png(clear))
    page.wait_for_function("document.querySelectorAll('.el.image-el img').length===2")
    got=info('.el.image-el >> nth=1 >> img')
    assert got['leftAlpha']<16 and got['w']==800,('Transparency was lost',got)
    page.locator('.el[data-id="c1"]').click(position={'x':4,'y':4})
    page.locator('[data-tab="appearance"]').click()
    page.set_input_files('#bgUpload',png(big))
    page.wait_for_selector('.el[data-id="c1"] img.card-bg-image')
    got=info('.el[data-id="c1"] img.card-bg-image')
    assert got['src'].startswith('data:image/jpeg') and max(got['w'],got['h'])==1600,got
    context.close()

    context=browser.new_context()
    page=open_editor(context)
    import_json(page,[{**card(1),'bgImage':big}])
    page.locator('[data-tab="files"]').click(); page.locator('#compressImages').click()
    page.wait_for_function("!document.getElementById('compressImages').disabled")
    page.wait_for_timeout(200)
    assert page.dialogs and 'было' in page.dialogs[-1],page.dialogs
    got=info('.el[data-id="c1"] img.card-bg-image')
    assert got['src'].startswith('data:image/jpeg') and got['length']<len(big)/4,got
    page.locator('#undo').click()
    assert page.locator('.el[data-id="c1"] img.card-bg-image').evaluate('i=>i.src')==big,'Ctrl+Z did not bring the original picture back'
    context.close()

    context=browser.new_context()
    page=open_editor(context)
    heavy=lambda n:'data:image/png;base64,'+chr(65+n)*3_000_000  # three 6 MB strings: two copies already fill the old budget
    import_json(page,[{**card(i),'bgImage':heavy(i)} for i in (1,2,3)])
    page.locator('.el[data-id="c1"]').click(position={'x':4,'y':4})
    page.locator('[data-tab="layers"]').click()
    for i in range(12): page.locator('#front' if i%2 else '#back').click()
    steps=0
    while page.locator('#undo').is_enabled() and steps<40:
        page.locator('#undo').click(); steps+=1
    assert steps>=12,('Large pictures still cut undo short',steps)
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': pictures are shrunk on upload and on request; undo keeps its steps with large pictures')

    # 13. One save per layout: two downloaded files never overwrite each other
    #     (3.8 and earlier kept a single save, so file B opened file A's work),
    #     «Мои макеты» lists, opens, downloads and deletes saves, a clean editor
    #     file continues the latest layout, and a file exported by 3.3–3.8 (no id)
    #     finds its own save every time.
    for kind,query in backends:
      context=browser.new_context(accept_downloads=True)
      folder=Path(tempfile.mkdtemp(prefix='dnd-layouts-'))
      ident=lambda pg:pg.evaluate('document.documentElement.dataset.layoutId')
      def export(pg,name):
          pg.locator('[data-tab="files"]').click()
          with pg.expect_download() as downloaded:
              pg.locator('#export').click()
          target=folder/name; shutil.copy2(downloaded.value.path(),target)
          return downloaded.value.suggested_filename,target
      def delete_card(pg):
          pg.locator('.el.card').first.click(position={'x':2,'y':2}); pg.keyboard.press('Delete')
      page=open_editor(context,html_path.as_uri()+query)
      page.locator('[data-tab="files"]').click(); page.locator('#layoutName').fill('Альфа')
      assert page.title().startswith('Альфа · '),page.title()
      delete_card(page)
      suggested,file_a=export(page,'a.html')
      assert suggested.startswith('Альфа_') and suggested.endswith('.html'),suggested
      id_a=ident(page)
      assert f'data-layout-id="{id_a}"' in file_a.read_text(encoding='utf-8')
      # A clean editor file continues the latest layout; «Сбросить» starts a new one beside it.
      page=open_editor(context,html_path.as_uri()+query)
      assert ident(page)==id_a and page.locator('.el').count()==len(starter)-1
      page.locator('[data-tab="files"]').click()
      with page.expect_download():
          page.locator('#resetStorage').click()
      id_b=ident(page)
      assert id_b!=id_a and page.locator('.el').count()==len(starter)
      page.locator('#layoutName').fill('Бета')
      delete_card(page); delete_card(page); delete_card(page)   # Бета: starter-3
      _,file_b=export(page,'b.html'); wait_saved(page); page.close()
      a=open_editor(context,file_a.as_uri()+query)
      assert ident(a)==id_a and a.locator('.el').count()==len(starter)-1 and a.locator('#layoutName').input_value()=='Альфа'
      delete_card(a); wait_saved(a); a.close()                      # Альфа: starter-2, saved after file B
      b=open_editor(context,file_b.as_uri()+query)
      assert ident(b)==id_b,'File B must open its own save'
      assert b.locator('.el').count()==len(starter)-3 and b.locator('#layoutName').input_value()=='Бета','File B must not show the newer work of file A'
      assert b.locator('.notice').count()==0,'Its own, identical save opens without a notice'
      # «Мои макеты»: both saves; open the other one, download it, delete a save.
      b.locator('[data-tab="files"]').click(); b.locator('#layouts').click()
      b.wait_for_selector('#layoutsDialog[open] li strong')
      rows=b.locator('#layoutsDialog li')
      assert sorted(rows.locator('strong').all_inner_texts())==['Альфа','Бета'],rows.locator('strong').all_inner_texts()
      assert 'открыт сейчас' in b.locator(f'#layoutsDialog li[data-id="{id_b}"]').inner_text()
      with b.expect_download() as downloaded:
          b.locator(f'#layoutsDialog li[data-id="{id_a}"]').get_by_role('button',name='Скачать JSON').click()
      assert downloaded.value.suggested_filename=='Альфа.json'
      assert len(json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8')))==len(starter)-2
      b.locator(f'#layoutsDialog li[data-id="{id_a}"]').get_by_role('button',name='Открыть').click()
      b.wait_for_function(f"document.documentElement.dataset.layoutId==='{id_a}'")
      assert b.locator('#layoutName').input_value()=='Альфа' and b.title().startswith('Альфа')
      assert b.locator('#undo').is_disabled(),'Another layout starts its own undo history'
      delete_card(b)
      assert len(saved_layout(b,id_a))==len(starter)-3 and len(saved_layout(b,id_b))==len(starter)-3,'Edits go to the opened layout only'
      b.locator('#layouts').click()
      b.locator(f'#layoutsDialog li[data-id="{id_b}"]').get_by_role('button',name='Удалить').click()
      b.wait_for_function(f"!document.querySelector('#layoutsDialog li[data-id=\"{id_b}\"]')")
      assert 'Удалить сохранение «Бета»' in b.dialogs[-1]
      assert saved_record(b,id_b) is None
      b.keyboard.press('Escape')
      # A clean editor file with several saves says which one it opened.
      put_saved(b,{'id':'other','name':'Гамма','savedAt':'2000-01-01T00:00:00Z','items':starter})
      clean=open_editor(context,html_path.as_uri()+query)
      assert ident(clean)==id_a,'The most recently saved layout opens'
      assert clean.locator('.notice[data-notice="layouts"]').is_visible(),clean.locator('.notice').all_inner_texts()
      # A file exported by 3.3–3.8 has no id: it gets one from its content, the
      # same every time, and points to work saved after its export.
      old=folder/'old.html'
      old.write_text(re.sub(r' data-layout-(id|name)="[^"]*"','',file_a.read_text(encoding='utf-8'))
                     .replace('data-saved-at="','data-saved-at="2020-01-01T00:00:00.000Z" data-was="'),encoding='utf-8')
      first=open_editor(context,old.as_uri()+query)
      old_id=ident(first)
      assert old_id.startswith('f-') and first.locator('.el').count()==len(starter)-1
      newer=first.locator('.notice[data-notice="newer"]')
      assert newer.is_visible() and 'Альфа' in newer.inner_text(),'Work saved after the export must be pointed out'
      delete_card(first); wait_saved(first); first.close()
      second=open_editor(context,old.as_uri()+query)
      assert ident(second)==old_id and second.locator('.el').count()==len(starter)-2,'The old file must find its own save'
      assert second.locator('.notice[data-notice="newer"]').count()==0
      newer_link=open_editor(context,old.as_uri()+query)
      for pg in (page,a,b,clean,first,second,newer_link):
          assert not pg.errors,pg.errors
      context.close()
      print('PASS '+engine+'/'+kind+': one save per layout; «Мои макеты»; clean and old files find the right save')

    browser.close()
print('All regression checks passed for '+engine)
