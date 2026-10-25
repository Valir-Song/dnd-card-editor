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

def open_editor(context,url=html_path.as_uri(),welcome=False):
    page=context.new_page()
    page.errors=[]
    page.dialogs=[]
    page.on('pageerror',lambda error:page.errors.append(str(error)))
    page.on('dialog',lambda dialog:(page.dialogs.append(dialog.message),dialog.accept()))
    page.goto(url,wait_until='load')
    page.wait_for_selector('.el .tiptap-content')
    # A first start shows the welcome notice (section 29); it makes the toolbar taller,
    # and the other sections measure the pages under it.
    if not welcome and page.locator('.notice[data-notice="welcome"]').count():
        page.locator('.notice[data-notice="welcome"] .notice-close').click()
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

# The welcome notice of a first start (section 29) stays out of checks for other notices.
OTHER_NOTICES='.notice:not([data-notice="welcome"])'
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
        import_json(page,[{'id':'x','kind':'card','page':21,'x':0,'y':0,'w':10,'h':10,'title':'t'}])
        assert page.dialogs and 'страница 21' in page.dialogs[-1] and 'не изменён' in page.dialogs[-1],page.dialogs
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
        bad=[{'id':'x','kind':'card','page':21,'x':0,'y':0,'w':10,'h':10}]
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
        assert page.locator(OTHER_NOTICES).count()==0
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
      assert same.locator(OTHER_NOTICES).count()==0,'Identical layouts must open without a notice'
      same.locator('#page2 .el.card').first.click(position={'x':2,'y':2})
      same.keyboard.press('Delete')                        # browser save is now newer: 26
      wait_saved(same); same.close()

      newer_browser=open_editor(context,exported.as_uri()+query)
      assert newer_browser.locator('.el').count()==len(starter)-2
      notice=newer_browser.locator('.notice[data-notice="freshness"]')
      assert notice.is_visible() and 'новее макета в этом файле' in notice.inner_text()
      notice.get_by_role('button',name='Открыть макет из файла').click()
      assert newer_browser.locator('.el').count()==len(starter)-1
      assert newer_browser.locator(OTHER_NOTICES).count()==0
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
      assert len(json.loads(Path(backup.value.path()).read_text(encoding='utf-8'))['items'])==len(starter)-2
      notice.get_by_role('button',name='Открыть макет из браузера').click()
      assert newer_file.locator('.el').count()==len(starter)-2

      # Reset: back up, then show this file's layout; Ctrl+Z restores.
      newer_file.locator('[data-tab="files"]').click()
      with newer_file.expect_download() as backup:
          newer_file.locator('#resetStorage').click()
      assert newer_file.dialogs and 'Сбросить сохранение' in newer_file.dialogs[-1]
      assert len(json.loads(Path(backup.value.path()).read_text(encoding='utf-8'))['items'])==len(starter)-2
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
    page.locator('.el[data-id="im"]').click(); page.locator('[data-tab="figures"]').click()
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
      assert b.locator(OTHER_NOTICES).count()==0,'Its own, identical save opens without a notice'
      # «Мои макеты»: both saves; open the other one, download it, delete a save.
      b.locator('[data-tab="files"]').click(); b.locator('#layouts').click()
      b.wait_for_selector('#layoutsDialog[open] li strong')
      rows=b.locator('#layoutsDialog li')
      assert sorted(rows.locator('strong').all_inner_texts())==['Альфа','Бета'],rows.locator('strong').all_inner_texts()
      assert 'открыт сейчас' in b.locator(f'#layoutsDialog li[data-id="{id_b}"]').inner_text()
      with b.expect_download() as downloaded:
          b.locator(f'#layoutsDialog li[data-id="{id_a}"]').get_by_role('button',name='Скачать JSON').click()
      assert downloaded.value.suggested_filename=='Альфа.json'
      assert len(json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))['items'])==len(starter)-2
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

    # 14. New objects go to a free spot: next to the selection, or in the part of
    #     the page on screen — never all on one point (3.9 and earlier: 35×110 mm).
    context=browser.new_context(viewport={'width':1280,'height':800})
    page=open_editor(context)
    import_json(page,[{'id':'A','kind':'card','page':1,'x':12,'y':40,'w':91,'h':23,'z':1,'title':'Карточка','meta':'м','detail':'д'}])
    boxes=lambda:page.evaluate("""()=>[...document.querySelectorAll('#page1 > .el')].map(e=>{const s=e.style;return {id:e.dataset.id,x:parseFloat(s.left),y:parseFloat(s.top),w:parseFloat(s.width),h:parseFloat(s.height)||2}})""")
    # A duplicate goes right under its card.
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('[data-tab="cards"]').click(); page.locator('#duplicate').click()
    copy=[b for b in boxes() if b['id']!='A'][0]
    assert copy['x']==12 and copy['y']==40+23+2,('The duplicate must go under its card',copy)
    page.locator('#page1').click(position={'x':4,'y':4})   # nothing selected
    page.locator('[data-tab="figures"]').click()
    for _ in range(3): page.locator('#rect').click()
    shapes=boxes()
    assert len(shapes)==5
    for i,a in enumerate(shapes):
        assert 0<=a['x'] and a['x']+a['w']<=210 and 0<=a['y'] and a['y']+a['h']<=297,('Off the page',a)
        for b in shapes[i+1:]:
            assert not (a['x']<b['x']+b['w'] and b['x']<a['x']+a['w'] and a['y']<b['y']+b['h'] and b['y']<a['y']+a['h']),('Objects overlap',a,b)
    # The first one (nothing selected) appeared on screen.
    first=page.locator('#page1 > .el.shape').first.bounding_box()
    assert 0<=first['y'] and first['y']+first['height']<=800,('The new object must be on screen',first)
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': new objects and duplicates go to a free spot, on screen')

    # 15. Group actions: with several objects selected (by Shift+click or a
    #     marquee there is no single "current" one, so 3.10.0-beta.1 and earlier
    #     did nothing) duplicate, layer moves, colour and delete act on all of them.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,y,z:{'id':i,'kind':'card','page':1,'x':12,'y':y,'w':60,'h':20,'z':z,'title':i,'meta':'м','detail':'д','bg':'#ffffff'}
    import_json(page,[card('A',30,1),card('B',40,2),{**card('C',55,3),'x':40}])
    def pick(*ids):
        page.locator('#page1').click(position={'x':4,'y':4})
        for n,i in enumerate(ids):
            page.locator(f'.el[data-id="{i}"]').click(position={'x':3,'y':3},modifiers=['Shift'] if n else [])
        assert page.locator('#selectionCount').inner_text()=='Выбрано: '+str(len(ids)),page.locator('#selectionCount').inner_text()
    data=lambda:{i['id']:i for i in saved_layout(page)}
    order=lambda:''.join(i for i,_ in sorted(((k,v['z']) for k,v in data().items()),key=lambda kv:kv[1]))
    # Layers: the pair keeps its own order (A under C) and skips over B.
    pick('A','C')
    page.locator('[data-tab="layers"]').click()
    page.locator('#back').click(); assert order()=='ACB',order()
    page.locator('#front').click(); assert order()=='BAC',order()
    page.locator('#backward').click(); assert order()=='ACB',order()
    page.locator('#forward').click(); assert order()=='BAC',order()
    assert page.locator('#selectionCount').inner_text()=='Выбрано: 2','The group stays selected'
    # Colour: both change, one undo brings both back.
    page.locator('[data-tab="appearance"]').click()
    page.evaluate("()=>{const i=document.getElementById('bg');i.value='#ff0000';i.dispatchEvent(new Event('input'))}")
    assert data()['A']['bg']=='#ff0000' and data()['C']['bg']=='#ff0000' and data()['B']['bg']=='#ffffff'
    assert page.locator('.el[data-id="C"]').evaluate('e=>e.style.backgroundColor')=='rgb(255, 0, 0)'
    page.locator('#undo').click()
    assert data()['A']['bg']=='#ffffff' and data()['C']['bg']=='#ffffff','One undo restores the whole group'
    # Duplicate: two copies laid out like the originals, under the group, selected; one undo.
    pick('A','C')
    page.locator('[data-tab="cards"]').click(); page.locator('#duplicate').click()
    copies=[v for k,v in data().items() if k not in 'ABC']
    assert len(copies)==2,copies
    a2,c2=sorted(copies,key=lambda v:v['x'])
    assert (c2['x']-a2['x'],c2['y']-a2['y'])==(28,25),('The copies keep their layout',a2,c2)
    assert min(a2['y'],c2['y'])>=30+45,('The copies go under the group',a2,c2)
    assert page.locator('#selectionCount').inner_text()=='Выбрано: 2','The copies become the selection'
    page.locator('#undo').click()
    assert sorted(data())==['A','B','C'],'One undo removes both copies'
    # Delete: both go, undo brings both back.
    pick('A','C')
    page.keyboard.press('Delete')
    assert sorted(data())==['B']
    page.locator('#undo').click()
    assert sorted(data())==['A','B','C']
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': group duplicate, layers, colour and delete act on the whole selection')

    # 16. Copy, cut and paste of objects. Chromium uses the real keys and system
    #     clipboard; Firefox under Playwright has no clipboard access, so the same
    #     events are dispatched with their own DataTransfer.
    # SYNTHETIC_CLIPBOARD=1 runs the Firefox path in Chromium (Firefox exists only in CI).
    real_keys=engine=='chromium' and not os.environ.get('SYNTHETIC_CLIPBOARD')
    context=browser.new_context(**({'permissions':['clipboard-read','clipboard-write']} if real_keys else {}))
    page=open_editor(context)
    card=lambda i,x,y:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':60,'h':20,'z':1,'title':'Карта '+i,'meta':'м','detail':'д'}
    import_json(page,[card('A',12,30),card('B',100,30)])
    clip={'text':''}
    def keys(pg,action):
        if real_keys:
            pg.keyboard.press('Control+'+{'copy':'c','cut':'x','paste':'v'}[action]); return
        clip['text']=pg.evaluate("""([type,text])=>{const dt=new DataTransfer();if(text)dt.setData('text/plain',text);
          const target=document.activeElement&&document.activeElement!==document.body?document.activeElement:document.body;
          // Firefox drops clipboardData given to the constructor of a synthetic event: attach it directly.
          const event=new ClipboardEvent(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:dt});
          target.dispatchEvent(event);return dt.getData('text/plain')}""",
          [action,clip['text'] if action=='paste' else ''])or clip['text']
    def els(pg): return pg.evaluate("""()=>[...document.querySelectorAll('#page1 > .el')].map(e=>({id:e.dataset.id,x:parseFloat(e.style.left),y:parseFloat(e.style.top),title:e.querySelector('.title')?.innerText.trim()}))""")
    pick=lambda pg,i,shift=False:pg.locator(f'.el[data-id="{i}"]').click(position={'x':3,'y':3},modifiers=['Shift'] if shift else [])
    # Copy + paste: a new object under the original, same content; one undo removes it.
    pick(page,'A'); keys(page,'copy'); keys(page,'paste')
    now=els(page); new=[e for e in now if e['id'] not in ('A','B')]
    assert len(new)==1 and new[0]['title']=='Карта A' and (new[0]['x'],new[0]['y'])==(12,52),('A copy goes under its original',now)
    assert len({e['id'] for e in now})==3,'The copy gets its own id'
    page.locator('#undo').click(); assert len(els(page))==2,'One undo removes the pasted copy'
    # Inside a text field the keys work on text, not on objects: copying selected
    # text gives text, and pasting objects there adds no objects (Tiptap gets it).
    # (A real Ctrl+V into Tiptap under Playwright reads the clipboard before an
    # earlier write lands now and then, with or without this feature, so the
    # paste goes to the field as an event.)
    page.locator('.el[data-id="B"] .title .tiptap-content').click()
    page.keyboard.press('End')
    if real_keys:
        page.keyboard.press('Shift+Home'); keys(page,'copy')
        assert page.evaluate('navigator.clipboard.readText()')=='Карта B','Text copy must stay text'
    added=page.evaluate("""text=>{const dt=new DataTransfer();dt.setData('text/plain',text);
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:dt});
      document.querySelector('.el[data-id="B"] .title .tiptap-content').dispatchEvent(event);
      return document.querySelectorAll('#page1 > .el').length}""",page.evaluate("()=>JSON.stringify({kind:'dnd-card-editor/objects',version:1,items:[{id:'q',kind:'shape',page:1,x:1,y:1,w:5,h:5}]})"))
    assert added==2,'Paste into a text field must not add objects'
    page.locator('#page1').click(position={'x':4,'y':4})
    # Cut a group: both go; paste puts them back where they were, as one undo step each.
    # (Right after text editing: the old text selection must not swallow the keys.)
    pick(page,'A'); pick(page,'B',True); keys(page,'cut')
    assert els(page)==[],'Cut removes the whole selection'
    keys(page,'paste')
    back=sorted((e['x'],e['y'],e['title']) for e in els(page))
    assert [(x,y) for x,y,_ in back]==[(12,30),(100,30)] and back[0][2]=='Карта A',('A cut group returns to its place',back)
    page.locator('#undo').click(); assert els(page)==[]
    page.locator('#undo').click(); assert len(els(page))==2,'Undoing the cut restores the originals'
    # A text field that last held the caret must not get the objects too: with the
    # focus away from text, a paste aimed at it adds the object only, and a cut does
    # not cut the field's text (owner's report: the card's JSON landed in a title).
    title=lambda:page.locator('.el[data-id="B"] .title').inner_text()
    before_title=title()
    page.locator('.el[data-id="B"] .title .tiptap-content').click()
    page.keyboard.press('End'); page.keyboard.press('Shift+Home')
    pick(page,'A'); keys(page,'copy')
    assert page.evaluate("document.activeElement===document.body||!document.activeElement.isContentEditable")
    count=len(els(page))
    page.evaluate("""text=>{const dt=new DataTransfer();dt.setData('text/plain',text);
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:dt});
      document.querySelector('.el[data-id="B"] .title .tiptap-content').dispatchEvent(event)}""",clip['text'] if not real_keys else page.evaluate('navigator.clipboard.readText()'))
    assert len(els(page))==count+1 and title()==before_title,('Paste must add the object only',title())
    page.locator('#undo').click()
    page.locator('.el[data-id="B"] .title .tiptap-content').click()
    page.keyboard.press('End'); page.keyboard.press('Shift+Home')
    pick(page,'A'); keys(page,'cut')
    assert title()==before_title,('Cutting objects must not cut text',title())
    assert 'A' not in [e['id'] for e in els(page)]
    page.locator('#undo').click()
    # Into another layout (another editor file in the same browser).
    pick(page,'A'); keys(page,'copy')
    other=open_editor(context); import_json(other,[card('Z',60,120)])
    if not real_keys: other.evaluate('document.body.focus()')
    keys(other,'paste')
    got=[e for e in els(other) if e['id']!='Z']
    assert len(got)==1 and got[0]['title']=='Карта A' and (got[0]['x'],got[0]['y'])==(12,30),('Paste into another file',got)
    assert not page.errors and not other.errors,(page.errors,other.errors)
    context.close()
    print('PASS '+engine+': copy, cut and paste of objects; text keys stay text; works across files')

    # 17. Locked objects (3.11): a locked background lets a marquee start on it and
    #     pick the cards above (before, the press dragged the background away); a
    #     click still selects it; it never moves, resizes or gets deleted, while
    #     its text stays editable. Copies start unlocked; the lock is saved.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,x,y,z:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':60,'h':20,'z':z,'title':i,'meta':'м','detail':'д','level':'1','bg':'#ffffff'}
    import_json(page,[{'id':'BG','kind':'shape','shape':'rect','page':1,'x':10,'y':20,'w':190,'h':150,'z':1,'bg':'#eeeeee','locked':True},
                      card('A',20,30,2),card('B',100,30,3)])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    status=lambda:page.locator('#selectionCount').inner_text()
    def at(x,y):
        b=page.locator('#page1').bounding_box();k=b['width']/210
        return b['x']+x*k,b['y']+y*k
    def drag(start,end,steps=8):
        page.mouse.move(*start); page.mouse.down(); page.mouse.move(*end,steps=steps); page.mouse.up()
    left=lambda i:page.locator(f'.el[data-id="{i}"]').evaluate('e=>e.style.left')
    frame='.gesture-frame:not(.inner):not([hidden])'
    # A marquee starting on the locked background selects the cards, not the background.
    drag(at(15,25),at(170,60))
    assert status()=='Выбрано: 2',('The marquee must pick the cards over a locked background',status())
    assert left('BG')=='10mm' and data()['BG']['x']==10,'The locked background must not move'
    # Shift+marquee from it adds to the selection; Shift+click toggles it.
    page.locator('.el[data-id="B"]').click(position={'x':3,'y':3})
    page.mouse.move(*at(15,25)); page.keyboard.down('Shift'); page.mouse.down(); page.mouse.move(*at(60,45),steps=8); page.mouse.up()
    assert status()=='Выбрано: 2',('Shift+marquee from a locked object adds to the selection',status())
    page.mouse.click(*at(15,100)); page.keyboard.up('Shift')
    assert status()=='Выбрано: 3 · закреплено: 1',status()
    # A click selects it: no handles, a lock badge, «Закреплён».
    page.mouse.click(*at(15,100))
    assert status()=='Закреплён',status()
    assert page.locator(frame).evaluate("f=>f.classList.contains('locked')")
    assert page.locator(frame+' [data-dir="se"]').bounding_box() is None,'A locked object has no resize handles'
    assert page.locator(frame+' .gesture-lock').is_visible()
    # Dragging it draws a marquee instead; it stays.
    drag(at(15,100),at(60,140))
    assert left('BG')=='10mm' and data()['BG']['x']==10
    # Delete leaves it, with a notice that offers to unlock it (one undo step).
    page.mouse.click(*at(15,100))
    page.keyboard.press('Delete')
    assert 'BG' in data(),'Delete must not remove a locked object'
    notice=page.locator('[data-notice="locked"]')
    assert notice.is_visible() and 'не удалён' in notice.inner_text(),notice.inner_text()
    notice.locator('button',has_text='Открепить').click()
    assert 'locked' not in data()['BG'],'Unlocking removes the field'
    page.locator('#undo').click()
    assert data()['BG'].get('locked') is True,'Undo locks it again'
    # The button locks the selected card and shows the state.
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('[data-tab="cards"]').click()
    lock=page.locator('#lock')
    assert 'Закрепить' in lock.inner_text() and lock.get_attribute('aria-pressed')=='false'
    lock.click()
    assert data()['A'].get('locked') is True
    assert 'Открепить' in lock.inner_text() and lock.get_attribute('aria-pressed')=='true'
    assert page.locator('.el[data-id="A"]').evaluate("e=>e.classList.contains('locked')")
    # It does not move by its body or its badge, but its text is still typed into.
    box=page.locator('.el[data-id="A"]').bounding_box()
    drag((box['x']+3,box['y']+3),(box['x']+60,box['y']+40))
    assert left('A')=='20mm' and data()['A']['x']==20,'A locked card must not move'
    badge=page.locator('.el[data-id="A"] .level').bounding_box()
    drag((badge['x']+badge['width']/2,badge['y']+badge['height']/2),(badge['x']-40,badge['y']+5))
    assert 'badgeX' not in data()['A'],'The badge of a locked card stays'
    page.locator('.el[data-id="A"] .title .tiptap-content').click()
    page.keyboard.press('End'); page.keyboard.type('Z')
    assert page.locator('.el[data-id="A"] .title').inner_text().strip()=='AZ'
    # Its text frames have no handles or drag bands.
    page.locator('.el[data-id="A"] .detail .tiptap-content').click()
    inner='.gesture-frame.inner:not([hidden])'
    assert page.locator(inner).evaluate("f=>f.classList.contains('locked')")
    assert page.locator(inner+' [data-dir="se"]').bounding_box() is None
    assert page.locator(inner+' .gesture-edge.top').evaluate("e=>getComputedStyle(e).pointerEvents")=='none'
    # Ctrl+Shift+L toggles the lock (outside text).
    page.locator('.el[data-id="B"]').click(position={'x':3,'y':3})
    page.keyboard.press('Control+Shift+L')
    assert data()['B'].get('locked') is True,'Ctrl+Shift+L locks'
    page.keyboard.press('Control+Shift+L')
    assert 'locked' not in data()['B'],'Ctrl+Shift+L unlocks'
    # A duplicate of a locked card starts unlocked.
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('#duplicate').click()
    copies=[v for k,v in data().items() if k not in ('BG','A','B')]
    assert len(copies)==1 and 'locked' not in copies[0] and data()['A'].get('locked') is True,copies
    page.locator('#undo').click()
    # In a group with a locked card, the others move and get deleted; it stays.
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('.el[data-id="B"]').click(position={'x':3,'y':3},modifiers=['Shift'])
    assert status()=='Выбрано: 2 · закреплено: 1',status()
    assert page.locator(frame+' [data-dir="se"]').bounding_box() is None,'No handles while a locked object is in the group'
    box=page.locator('.el[data-id="B"]').bounding_box()
    drag((box['x']+3,box['y']+3),(box['x']+3+38,box['y']+3))
    moved=data()
    assert moved['A']['x']==20 and moved['B']['x']>100,('Only the unlocked one moves',moved['A']['x'],moved['B']['x'])
    page.locator('#undo').click()
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('.el[data-id="B"]').click(position={'x':3,'y':3},modifiers=['Shift'])
    page.keyboard.press('Delete')
    assert sorted(data())==['A','BG'] and status()=='Закреплён',(sorted(data()),status())
    page.locator('#undo').click(); assert sorted(data())==['A','B','BG']
    # «Удалить» and cut leave it too (cut still copies it).
    page.locator('.el[data-id="A"]').click(position={'x':3,'y':3})
    page.locator('#delete').click()
    assert 'A' in data()
    copied=page.evaluate("""()=>{const dt=new DataTransfer();const e=new ClipboardEvent('cut',{bubbles:true,cancelable:true});
      Object.defineProperty(e,'clipboardData',{value:dt});document.body.dispatchEvent(e);return dt.getData('text/plain')}""")
    assert '"id":"A"' in copied and 'A' in data(),'Cut copies a locked object but leaves it'
    # «Открепить всё на странице»: every lock of the page goes, as one undo step.
    page.locator('.el[data-id="B"]').click(position={'x':3,'y':3})
    page.keyboard.press('Control+Shift+L')
    assert data()['A'].get('locked') and data()['B'].get('locked') and data()['BG'].get('locked')
    page.locator('#unlockPage').click()
    assert not any(data()[i].get('locked') for i in ('A','B','BG')),'All locks of the page are gone'
    page.locator('#undo').click()
    assert all(data()[i].get('locked') for i in ('A','B','BG')),'One undo brings them back'
    # The lock is saved with the layout.
    wait_saved(page)
    again=open_editor(context)
    assert again.locator('.el[data-id="A"]').evaluate("e=>e.classList.contains('locked')")
    assert not page.errors and not again.errors,(page.errors,again.errors)
    context.close()
    print('PASS '+engine+': locked objects stay put, let the marquee through, keep editable text')

    # 18. Arrow keys (3.11): 1 mm per press, Shift 5 mm or to the next grid line;
    #     a series is one undo step; the group stays on the page; locked objects
    #     stay; in text the arrows move the caret, Esc leaves the text and then
    #     they move its frame. The grid is drawn faintly while it is on, never
    #     printed or exported.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    card=lambda i,x,y,z,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':60,'h':20,'z':z,'title':i,'meta':'м','detail':'д','bg':'#ffffff',**extra}
    import_json(page,[card('A',20,30,1),card('B',100,30,2),card('L',20,100,3,locked=True)])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    pos=lambda i:(data()[i]['x'],data()[i]['y'])
    # In the card's left padding: clear of its texts and of the handles of a selected card.
    pick=lambda i,shift=False:page.locator(f'.el[data-id="{i}"]').click(position={'x':4,'y':20},modifiers=['Shift'] if shift else [])
    keys=lambda *names:[page.keyboard.press(n) for n in names]
    def into_text(selector):
        """Click into a text and wait until the caret is there (slow CI runners lag)."""
        page.locator(selector+' .tiptap-content').click()
        page.wait_for_function("s=>!!document.activeElement?.closest?.(s)",arg=selector)
    pick('A'); keys('ArrowRight','ArrowRight','ArrowRight','ArrowDown')
    assert pos('A')==(23,31),pos('A')
    assert page.locator('.el[data-id="A"]').evaluate('e=>e.style.left')=='23mm'
    keys('Shift+ArrowRight'); assert pos('A')==(28,31),('Shift: 5 mm without a grid',pos('A'))
    page.locator('#undo').click(); assert pos('A')==(20,30),('One undo for the series',pos('A'))
    keys(*['Shift+ArrowLeft']*6); assert pos('A')==(0,30),('Kept on the page',pos('A'))
    page.locator('#undo').click(); assert pos('A')==(20,30)
    # With a 5 mm grid Shift goes to the next grid line; the grid shows on the sheet.
    page.select_option('#snapGrid','5')
    assert page.locator('.stage').get_attribute('data-grid')=='5'
    grid_style=lambda prop:page.evaluate("p=>getComputedStyle(document.querySelector('#page1'),'::before')[p]",prop)
    assert 'gradient' in grid_style('backgroundImage'),grid_style('backgroundImage')
    pick('A'); keys('ArrowRight','Shift+ArrowRight'); assert pos('A')==(25,30),pos('A')
    keys('Shift+ArrowRight'); assert pos('A')==(30,30)
    keys('Shift+ArrowLeft','Shift+ArrowDown'); assert pos('A')==(25,35),pos('A')
    page.emulate_media(media='print'); assert grid_style('display')=='none','The grid is never printed'
    page.emulate_media(media='screen')
    # A file opened with the grid already on (the setting is remembered) exports without it.
    gridded=open_editor(context)
    assert gridded.locator('.stage').get_attribute('data-grid')=='5'
    gridded.locator('[data-tab="files"]').click()
    with gridded.expect_download() as download: gridded.locator('#export').click()
    stage_tag=re.search(r'<main[^>]*class="stage"[^>]*>',Path(download.value.path()).read_text(encoding='utf-8')).group(0)
    assert 'data-grid' not in stage_tag,('The grid is not part of the file',stage_tag)
    gridded.close()
    page.locator('#snapToggle').uncheck()
    assert page.locator('.stage').get_attribute('data-grid') is None and grid_style('content') in ('none','normal')
    page.locator('#snapToggle').check(); page.select_option('#snapGrid','0')
    assert page.locator('.stage').get_attribute('data-grid') is None
    # A group moves together; a locked object stays (alone or in the group).
    a,b=pos('A'),pos('B')
    pick('A'); pick('B',True); keys('ArrowDown')
    assert pos('A')==(a[0],a[1]+1) and pos('B')==(b[0],b[1]+1)
    a=pos('A'); pick('A'); pick('L',True); keys('ArrowRight')
    assert pos('A')==(a[0]+1,a[1]) and pos('L')==(20,100),'Locked objects do not move'
    pick('L'); keys('ArrowRight','ArrowDown'); assert pos('L')==(20,100)
    # In text the arrows move the caret, not the card.
    b=pos('B')
    into_text('.el[data-id="B"] .title')
    # Characters before the caret in B's title. On a slow runner the editor reads
    # the caret moved by a key a moment later: wait for it before the next key.
    caret="()=>{const t=document.querySelector('.el[data-id=\"B\"] .title'),s=getSelection();if(!s.rangeCount||!t.contains(s.anchorNode))return -1;const r=s.getRangeAt(0).cloneRange();r.setStart(t,0);return r.toString().length}"
    def caret_to(key,where):
        # A key pressed while the editor is still settling is sometimes lost (CI, both browsers):
        # press it again rather than fail; the card must still stay put (checked below).
        for _ in range(3):
            keys(key)
            try: page.wait_for_function("("+caret+")()==="+str(where),timeout=3000); return
            except Exception: pass
        raise AssertionError(('The caret did not move with '+key,page.evaluate(caret)))
    caret_to('End',1); caret_to('ArrowLeft',0)
    page.evaluate("()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    page.keyboard.type('Q')
    title=page.locator('.el[data-id="B"] .title').inner_text().strip()
    assert pos('B')==b and title=='QB',('In text the arrows move the caret',pos('B'),b,title,data()['B'].get('textFrames'))
    # Esc leaves the text; the arrows then move its frame inside the card.
    into_text('.el[data-id="B"] .detail')
    keys('Escape')
    assert page.evaluate('!document.activeElement.isContentEditable'),'Esc leaves the text'
    assert page.locator('.gesture-frame.inner:not([hidden])').count()==1,'The text frame stays selected'
    keys('ArrowRight','ArrowDown')
    frame=data()['B'].get('textFrames',{}).get('detail',{})
    assert (frame.get('x'),frame.get('y'))==(1,1) and pos('B')==b,(frame,pos('B'))
    page.locator('#undo').click()
    assert not data()['B'].get('textFrames',{}).get('detail',{}).get('x'),'One undo for the frame series'
    # After a toolbar button the arrows move the selection (here the new copy).
    pick('A'); page.locator('[data-tab="cards"]').click(); page.locator('#duplicate').click()
    copy=[k for k in data() if k not in ('A','B','L')][0]; c=pos(copy)
    keys('ArrowDown'); assert pos(copy)==(c[0],c[1]+1),'The arrows move the new copy'
    # On a toolbar tab they switch tabs and move nothing.
    a=pos('A'); pick('A'); page.locator('[data-tab="cards"]').click(); keys('ArrowRight')
    assert pos('A')==a and page.locator('[data-tab="appearance"]').get_attribute('aria-selected')=='true'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': arrow keys move the selection, by grid with Shift; the grid shows on screen only')

    # 19. «Выравнивание» (3.11): align to the selection's edge or centre (one
    #     object: to the sheet's 5 mm frame), equal gaps, one width; a locked
    #     object is the edge the others align to and never moves; text frames
    #     of a card line up too. Each button is one undo step.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,x,y,w,h,z,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':w,'h':h,'z':z,'title':i,'meta':'мета '+i,'detail':'д','bg':'#ffffff',**extra}
    import_json(page,[card('A',10,30,60,20,1,textFrames={'title':{'x':6}}),card('B',70,50,40,20,2),card('C',130,40,50,30,3),card('L',30,120,60,20,4,locked=True)])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    xs=lambda *ids:[data()[i]['x'] for i in ids]
    ys=lambda *ids:[data()[i]['y'] for i in ids]
    pick=lambda i,shift=False:page.locator(f'.el[data-id="{i}"]').click(position={'x':4,'y':20},modifiers=['Shift'] if shift else [])
    def picks(*ids):
        page.locator('#page1').click(position={'x':4,'y':4})
        for n,i in enumerate(ids): pick(i,n>0)
    press=lambda button:page.locator('#'+button).click()
    page.locator('[data-tab="align"]').click()
    assert page.locator('#alignLeft').is_disabled(),'Nothing selected: the buttons are off'
    picks('A','B')
    assert page.locator('#alignLeft').is_enabled() and page.locator('#distributeX').is_disabled() and page.locator('#sameWidth').is_enabled()
    picks('A','B','C')
    assert page.locator('#distributeX').is_enabled()
    press('alignTop'); assert ys('A','B','C')==[30,30,30],ys('A','B','C')
    page.locator('#undo').click(); assert ys('A','B','C')==[30,50,40],'One undo per button'
    press('alignCenter'); assert xs('A','B','C')==[65,75,70],xs('A','B','C')
    page.locator('#undo').click()
    press('alignBottom'); assert ys('A','B','C')==[50,50,40],ys('A','B','C')
    page.locator('#undo').click()
    press('distributeX'); assert xs('A','B','C')==[10,80,130],('Equal 10 mm gaps',xs('A','B','C'))
    press('sameWidth'); assert [data()[i]['w'] for i in 'ABC']==[60,60,60],'The width of the first one picked'
    assert page.locator('.el[data-id="C"]').evaluate('e=>e.style.width')=='60mm'
    page.locator('#undo').click(); page.locator('#undo').click()
    # One object: to the sheet's frame.
    picks('B')
    press('alignCenter'); assert xs('B')==[85],xs('B')
    press('alignRight'); assert xs('B')==[165]
    press('alignTop'); assert ys('B')==[5]
    # A locked object is the edge the others go to, and it stays.
    picks('B'); pick('L',True)
    press('alignLeft'); assert xs('B','L')==[30,30],('Aligned to the locked card',xs('B','L'))
    press('alignBottom'); assert ys('L')==[120] and ys('B')==[120],ys('B','L')
    # Text frames of one card line up with each other (the title starts 6 mm in).
    picks('A')
    page.locator('.el[data-id="A"] .title .tiptap-content').click()
    meta=page.locator('.el[data-id="A"] .meta').bounding_box()  # its top lies under the title frame's drag band
    page.locator('.el[data-id="A"] .meta').click(modifiers=['Shift'],position={'x':6,'y':meta['height']-2})
    assert page.locator('#selectionCount').inner_text()=='Текстовых блоков: 2'
    page.keyboard.press('Escape')
    lefts=lambda:page.evaluate("""()=>['title','meta'].map(f=>document.querySelector('.el[data-id="A"] .text-wrap[data-field="'+f+'"]').getBoundingClientRect().left)""")
    before=lefts()
    assert before[0]-before[1]>15,before
    press('alignLeft')
    after=lefts()
    assert abs(after[0]-after[1])<1,('Text frames align left',after)
    assert abs(data()['A']['textFrames']['title']['x'])<0.01 and data()['A']['x']==10,'The title comes back; the card stays'
    page.locator('#undo').click()
    assert data()['A']['textFrames']['title']['x']==6,'One undo for the frames'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': align, distribute and one size act on the selection, the sheet, locked anchors and text frames')

    # 20. Smart snapping (3.11). On the sheet a dragged card keeps the spacing of
    #     its row or column, or centres between two neighbours, with pink gap
    #     marks; Alt turns it off. Inside a card a text frame snaps to that card
    #     only (its inner edge, centre, other texts) — never to other objects.
    context=browser.new_context(viewport={'width':1400,'height':1350})
    page=open_editor(context)
    card=lambda i,x,y,w=40,h=20,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':w,'h':h,'z':1,'title':i,'meta':'мета '+i,'detail':'описание','bg':'#ffffff',**extra}
    # Laid out so that no object edge or centre lies where C, R and V3 should
    # land: they can only get there by the gap.
    import_json(page,[card('A',10,30),card('B',60,30),card('C',150,40),
                      card('P',10,100),card('Q',124,100),card('R',170,140),
                      card('V1',160,150),card('V2',160,175),card('V3',160,240),
                      card('K',20,215,80,30,textFrames={'meta':{'x':4}}),card('M',30,265)])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    k=page.locator('#page1').bounding_box()['width']/210
    def drag_by(i,dx,dy,alt=False,check=None):
        """Press on the card's left padding and move it by (dx, dy) mm; `check` runs before the release."""
        box=page.locator(f'.el[data-id="{i}"]').bounding_box()
        x,y=box['x']+4,box['y']+20
        page.mouse.move(x,y); page.mouse.down()
        if alt: page.keyboard.down('Alt')   # held during the drag (Alt+press in a card picks its texts)
        page.mouse.move(x+dx*k,y+dy*k,steps=10)
        result=check() if check else None
        page.mouse.up()
        if alt: page.keyboard.up('Alt')
        return result
    gap_marks=lambda:page.evaluate("()=>[...document.querySelectorAll('#page1 > .gap-guide')].map(g=>g.dataset.gap)")
    # Next to a row: the 10 mm gap of A–B (C lands 1.2 mm short of it).
    marks=drag_by('C',-41.2,-10,check=gap_marks)
    assert data()['C']['x']==110 and data()['C']['y']==30,('C keeps the 10 mm gap of its row',data()['C'])
    assert marks==['10','10'],('Both equal gaps are marked',marks)
    assert gap_marks()==[],'The marks go when the drag ends'
    # Between two neighbours: centred (10 mm on each side).
    marks=drag_by('R',-102.4,-39.6,check=gap_marks)
    assert data()['R']['x']==67 and data()['R']['y']==100,('R is centred between P and Q',data()['R'])
    assert marks==['17','17'],('Centred: both gaps marked',marks)
    # A column: the 5 mm gap of V1–V2.
    drag_by('V3',0,-41)
    assert data()['V3']['y']==200,('V3 keeps the 5 mm gap of its column',data()['V3'])
    # Alt: no snapping at all.
    page.locator('#undo').click()   # V3 back to 240
    drag_by('V3',0,-41,alt=True)
    assert abs(data()['V3']['y']-199)<0.3,('Alt: no snapping',data()['V3'])
    # A text frame inside K (its meta starts 4 mm in).
    meta=lambda:(data()['K'].get('textFrames') or {}).get('meta',{}).get('x',0)
    def drag_frame(dx,alt=False):
        box=page.locator('.el[data-id="K"] .meta').bounding_box()
        page.locator('.el[data-id="K"] .meta').click(position={'x':box['width']-10,'y':box['height']-2})
        band=page.locator('.gesture-frame.inner:not([hidden]) .gesture-edge.left').bounding_box()
        x,y=band['x']+band['width']/2,band['y']+band['height']/2
        page.mouse.move(x,y); page.mouse.down()
        if alt: page.keyboard.down('Alt')
        page.mouse.move(x+dx*k,y,steps=8)
        guides=page.evaluate("()=>[...document.querySelectorAll('#page1 > .snap-guide.inner-guide')].map(g=>[g.className,g.style.top,g.style.height])")
        page.mouse.up()
        if alt: page.keyboard.up('Alt')
        return guides
    # 1.2 mm to the right its left edge meets M's left edge (30 mm): no snap, M is not in this card.
    drag_frame(1.2)
    assert abs(meta()-5.2)<0.3,('A text frame never snaps to other objects',meta())
    page.locator('#undo').click(); assert meta()==4
    # 3.4 mm to the left it meets the card's inner edge (where the title starts): snaps there.
    guides=drag_frame(-3.4)
    assert abs(meta())<0.01,('The text frame snaps to the inner edge of its card',meta())
    assert guides and guides[0][0].endswith(' x') and abs(float(guides[0][1][:-2])-215)<0.05 and abs(float(guides[0][2][:-2])-30)<0.05,('The guide spans the card only',guides)
    page.locator('#undo').click(); assert meta()==4
    drag_frame(-3.4,alt=True)
    assert abs(meta()-0.6)<0.3,('Alt: no snapping inside the card either',meta())
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': equal gaps and centring on the sheet; text frames snap to their own card only')

    # 21. Themes (3.11): the «Тема» list colours the selection (or the whole page
    #     with nothing selected), «Тему на весь лист» the page; one undo step;
    #     shapes keep their colour; «Без темы» brings back the default look.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,x,y,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':60,'h':20,'z':1,'title':i,'meta':'мета','detail':'д','bg':'#9ebbff',**extra}
    import_json(page,[card('A',10,30),card('B',100,30),{'id':'S','kind':'shape','shape':'rect','page':1,'x':10,'y':80,'w':30,'h':20,'z':2,'bg':'#d8c5ed'}])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    look=lambda i,sel='':page.locator(f'.el[data-id="{i}"] {sel}'.strip()).evaluate('e=>getComputedStyle(e).backgroundColor')
    page.locator('[data-tab="appearance"]').click()
    page.locator('.el[data-id="A"]').click(position={'x':4,'y':20})
    page.select_option('#theme','night')
    assert data()['A'].get('theme')=='night' and 'bg' not in data()['A'] and 'theme' not in data()['B'],'Only the selection'
    assert look('A')=='rgb(42, 35, 64)',look('A')
    assert page.locator('.el[data-id="A"] .meta').evaluate('e=>getComputedStyle(e).color')=='rgb(179, 165, 216)','The meta line follows the theme'
    page.locator('#undo').click()
    assert 'theme' not in data()['A'] and data()['A']['bg']=='#9ebbff','One undo'
    # Nothing selected: the whole page; shapes keep their colour.
    page.locator('#page1').click(position={'x':4,'y':4})
    page.select_option('#theme','forest')
    assert data()['A'].get('theme')=='forest' and data()['B'].get('theme')=='forest' and 'theme' not in data()['S'] and data()['S']['bg']=='#d8c5ed'
    # The list shows the theme of the selection; «Тему на весь лист» and «Без темы».
    page.locator('.el[data-id="B"]').click(position={'x':4,'y':20})
    assert page.locator('#theme').input_value()=='forest'
    page.select_option('#theme','ember'); page.locator('#themePage').click()
    assert data()['A'].get('theme')=='ember' and data()['B'].get('theme')=='ember'
    page.select_option('#theme','')
    assert 'theme' not in data()['B'] and data()['A'].get('theme')=='ember'
    assert look('B')=='rgb(255, 255, 255)','No theme: the default white card'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': themes colour the selection or the page, one undo step; shapes keep their colour')

    # 22. Badges (3.11): a click puts the caret in a badge (before, it could not
    #     be typed into at all); «+ Кружок» adds the main badge, then more beside
    #     it; signs and colours go to the badge clicked last, or to the main badge
    #     of every selected card; «− Кружок» removes; extra badges drag and save.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,x,y,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':80,'h':25,'z':1,'title':i,'meta':'м','detail':'д','bg':'#ffffff',**extra}
    import_json(page,[card('A',10,30),card('B',100,30,level='1'),{'id':'S','kind':'shape','shape':'rect','page':1,'x':10,'y':80,'w':30,'h':20,'z':2}])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    badge=lambda i,n=0:page.locator(f'.el[data-id="{i}"] > .level').nth(n)
    pick=lambda i,shift=False:page.locator(f'.el[data-id="{i}"]').click(position={'x':4,'y':20},modifiers=['Shift'] if shift else [])
    # Typing into a badge.
    badge('B').click(); page.keyboard.type('7')
    assert data()['B']['level']=='7',('A click lets you type into the badge',data()['B'].get('level'))
    # The tools are on their own tab, greyed out unless a card is selected.
    page.locator('[data-tab="badges"]').click()
    pick('S'); assert page.locator('#addBadge').is_disabled()
    pick('A'); assert page.locator('#addBadge').is_enabled()
    page.locator('#addBadge').click()
    assert data()['A']['level']=='1' and 'badges' not in data()['A'],'The first badge is the main one'
    page.locator('#addBadge').click()
    assert [b['text'] for b in data()['A']['badges']]==['★'],data()['A']
    # A sign and a colour to the badge clicked last.
    badge('A',1).click()
    page.locator('#badgeSymbols button',has_text='☾').click()
    page.locator('#badgeColors .badge-color').nth(3).click()
    extra=data()['A']['badges'][0]
    assert extra['text']=='☾' and extra['color']=='#b23a3a' and data()['A']['level']=='1',extra
    assert badge('A',1).evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(178, 58, 58)'
    # A group: each card gets one more; one undo takes both back.
    page.locator('#page1').click(position={'x':4,'y':4}); pick('A'); pick('B',True)
    page.locator('#addBadge').click()
    assert len(data()['A']['badges'])==2 and len(data()['B']['badges'])==1
    page.locator('#undo').click()
    assert len(data()['A']['badges'])==1 and 'badges' not in data()['B'],'One undo for the group'
    # A sign with no badge clicked: the main badge of each selected card.
    # (A click on a member of a group keeps the group: start from the blank sheet.)
    page.locator('#page1').click(position={'x':4,'y':4}); pick('A'); pick('B',True)
    page.locator('#badgeSymbols button',has_text='★').first.click()
    assert data()['A']['level']=='★' and data()['B']['level']=='★',(data()['A'],data()['B'])
    # Drag an extra badge; the main one stays.
    pick('A')
    box=badge('A',1).bounding_box(); x0=data()['A']['badges'][0]['x']
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2); page.mouse.down()
    page.mouse.move(box['x']+box['width']/2-60,box['y']+box['height']/2,steps=6); page.mouse.up()
    moved=data()['A']
    assert moved['badges'][0]['x']<x0-10 and 'badgeX' not in moved,('The extra badge moved alone',moved)
    # «− Кружок» removes the badge clicked last.
    badge('A',1).click(); page.locator('#removeBadge').click()
    assert 'badges' not in data()['A'] and data()['A']['level']=='★'
    # Saved with the layout.
    wait_saved(page)
    again=open_editor(context)
    assert again.locator('.el[data-id="B"] > .level').count()==1
    assert not page.errors and not again.errors,(page.errors,again.errors)
    context.close()
    print('PASS '+engine+': badges are typed into, added, signed, coloured, dragged and removed')

    # 23. Save to a file (3.11 beta.9): Ctrl+S writes the editor with its layout
    #     into a file picked once (File System Access API; stubbed, since a real
    #     file dialog cannot be driven), later presses and «Сохранить в файл» reuse
    #     it, Ctrl+Shift+S picks another; in any keyboard layout and while typing.
    #     A failed write is reported; without the API Ctrl+S downloads a copy.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    import_json(page,[{'id':'A','kind':'card','page':1,'x':10,'y':30,'w':80,'h':25,'z':1,'title':'Лютня','meta':'м','detail':'д','bg':'#ffffff'}])
    page.evaluate("""()=>{window.files=[];window.picks=[];window.failWrite=false;
      const file=name=>({name,createWritable:async()=>{if(window.failWrite)throw new Error('диск полон');let text='';
        return {write:async data=>{text+=data},close:async()=>{window.files.push({name,html:text})}}}});
      window.showSaveFilePicker=async options=>{window.picks.push(options.suggestedName);return file('picked'+window.picks.length+'.html')}}""")
    written=lambda n:page.wait_for_function('n=>window.files.length>=n',arg=n)
    last=lambda:page.evaluate('()=>window.files.at(-1)')
    page.keyboard.press('Control+s'); written(1)
    picks=page.evaluate('window.picks')
    assert len(picks)==1 and re.fullmatch(r'[\w]+\.html',picks[0]),('The dialog suggests the layout name as a file name',picks)
    assert last()['name']=='picked1.html' and '"title":"Лютня"' in last()['html'] and 'data-layout-id' in last()['html']
    assert 'picked1.html' in page.locator('#fileState').inner_text()
    # While typing: the text does not get an «s», the same file is written.
    page.locator('.el[data-id="A"] .title').click()
    page.wait_for_function('document.activeElement?.isContentEditable')
    page.keyboard.press('End'); page.keyboard.type('Б')
    page.keyboard.press('Control+s'); written(2)
    assert len(page.evaluate('window.picks'))==1,'No dialog the second time'
    assert last()['name']=='picked1.html' and '"title":"ЛютняБ"' in last()['html'],last()['name']
    assert page.locator('.el[data-id="A"] .title').inner_text().strip()=='ЛютняБ'
    # A Russian keyboard layout: the key is «ы», its place is KeyS.
    prevented=page.evaluate("()=>{const e=new KeyboardEvent('keydown',{key:'ы',code:'KeyS',ctrlKey:true,bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented}")
    written(3); assert prevented and last()['name']=='picked1.html'
    # The button does the same; Ctrl+Shift+S picks another file.
    page.locator('[data-tab="files"]').click(); page.locator('#saveFile').click(); written(4)
    assert len(page.evaluate('window.picks'))==1 and last()['name']=='picked1.html'
    page.keyboard.press('Control+Shift+S'); written(5)
    assert len(page.evaluate('window.picks'))==2 and last()['name']=='picked2.html'
    assert 'picked2.html' in page.locator('#fileState').inner_text()
    # The written file is the editor with the layout.
    target_file=Path(tempfile.mkdtemp())/'saved.html'
    target_file.write_text(last()['html'],encoding='utf-8')
    again=open_editor(context,target_file.as_uri())
    assert again.locator('.el[data-id="A"] .title').inner_text().strip()=='ЛютняБ'
    assert again.evaluate("document.querySelector('link[rel=icon]').href.startsWith('data:image/svg+xml,')"),'The icon travels with the file'
    again.close()
    # A failed write is reported and offers a download.
    page.evaluate('window.failWrite=true')
    page.keyboard.press('Control+s')
    page.wait_for_selector('[data-notice="file"]')
    notice=page.locator('[data-notice="file"]').inner_text()
    assert 'Не удалось сохранить в файл «picked2.html»' in notice and 'диск полон' in notice and 'Скачать HTML' in notice,notice
    page.evaluate('window.failWrite=false'); page.keyboard.press('Control+s'); written(6)
    assert page.locator('[data-notice="file"]').count()==0,'A successful save clears the warning'
    # Without the API (Firefox): a download, and a note why.
    page.evaluate('window.showSaveFilePicker=undefined')
    with page.expect_download() as download:
        page.keyboard.press('Control+s')
    assert download.value.suggested_filename.endswith('.html'),download.value.suggested_filename
    assert 'Chrome и Edge' in page.locator('[data-notice="file"]').inner_text()
    assert page.evaluate('window.files.length')==6
    assert not page.errors and not again.errors,(page.errors,again.errors)
    context.close()
    print('PASS '+engine+': Ctrl+S saves into the file picked once, Ctrl+Shift+S into another; otherwise a download')

    # 24. Sheet background (3.11 beta.10): a ready background and the owner's
    #     picture for the active page, kept in the layout as a 'sheet' object;
    #     one undo step; never selected or snapped to; «Фон на оба листа»; the
    #     downloaded HTML carries the picture.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    # Two sheets: the second one is held by an empty background (4.2: a layout has as many sheets as it uses).
    import_json(page,[{'id':'A','kind':'card','page':1,'x':40,'y':40,'w':60,'h':20,'z':1,'title':'A','meta':'м','detail':'д'},
      {'id':'P2','kind':'sheet','page':2,'x':0,'y':0,'w':210,'h':297,'z':0}])
    sheets=lambda:sorted([i for i in saved_layout(page) if i['kind']=='sheet' and (i.get('sheet') or i.get('src') or i['page']!=2)],key=lambda i:i['page'])
    page.locator('[data-tab="appearance"]').click()
    page.locator('#page1').click(position={'x':4,'y':4})
    assert page.locator('#sheetFit').is_disabled() and page.locator('#sheetRemove').is_disabled(),'No picture yet'
    page.select_option('#sheetTheme','stone')
    assert page.locator('#page1').get_attribute('data-sheet')=='stone' and page.locator('#page2').get_attribute('data-sheet') is None
    assert [(s['page'],s.get('sheet')) for s in sheets()]==[(1,'stone')],sheets()
    page.locator('#undo').click()
    assert page.locator('#page1').get_attribute('data-sheet') is None and sheets()==[],'One undo'
    # A picture (a 300×400 PNG), its opacity and fill.
    png=page.evaluate("""()=>{const c=document.createElement('canvas');c.width=300;c.height=400;const x=c.getContext('2d');
      x.fillStyle='#c33';x.fillRect(0,0,300,400);x.fillStyle='#33c';x.fillRect(0,200,300,200);return c.toDataURL('image/png').split(',')[1]}""")
    page.set_input_files('#sheetUpload',{'name':'фон.png','mimeType':'image/png','buffer':base64.b64decode(png)})
    page.wait_for_selector('#page1 > img.sheet-image')
    assert sheets()[0]['src'].startswith('data:image/'),'The picture is in the layout'
    page.locator('#sheetOpacity').fill('50'); page.locator('#sheetOpacity').dispatch_event('input')
    page.select_option('#sheetFit','contain')
    img=page.locator('#page1 > img.sheet-image')
    assert img.evaluate('e=>[e.style.opacity,e.style.objectFit]')==['0.5','contain']
    assert (sheets()[0].get('opacity'),sheets()[0].get('fit'))==(50,'contain'),sheets()
    assert page.locator('.el').count()==1,'The background is no object'
    # A marquee over the whole sheet takes the card only; dragging it does not snap to the background.
    box=page.locator('#page1').bounding_box(); k=box['width']/210
    page.mouse.move(box['x']+6,box['y']+85*k); page.mouse.down()
    page.mouse.move(box['x']+box['width']-6,box['y']+30*k,steps=8); page.mouse.up()
    page.wait_for_timeout(100)
    assert page.evaluate("[...document.querySelectorAll('.el.selected')].map(e=>e.dataset.id)")==['A']
    assert page.locator('#selectionCount').text_content()!='Выбрано: 2'
    # «Фон на оба листа» (page 1 is active: the card is there).
    page.locator('#sheetBoth').click()
    assert sorted(s['page'] for s in sheets())==[1,2] and sheets()[1]['src']==sheets()[0]['src']
    assert page.locator('#page2 > img.sheet-image').count()==1
    # The downloaded editor opens with the picture.
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as downloaded:
        page.locator('#export').click()
    folder=Path(tempfile.mkdtemp()); exported=folder/'sheet.html'
    shutil.copy2(downloaded.value.path(),exported)
    again=open_editor(context,exported.as_uri())
    assert again.locator('#page1 > img.sheet-image').evaluate('e=>e.complete&&e.naturalWidth>0'),'The picture travels with the file'
    assert again.locator('#page1').get_attribute('data-sheet') is None,'No ready background was left on page 1'
    again.close(); shutil.rmtree(folder,ignore_errors=True)
    # «Убрать картинку» keeps the ready background.
    page.locator('[data-tab="appearance"]').click()
    page.locator('#page1').click(position={'x':4,'y':4})
    page.select_option('#sheetTheme','night'); page.locator('#sheetRemove').click()
    assert page.locator('#page1 > img.sheet-image').count()==0 and page.locator('#page1').get_attribute('data-sheet')=='night'
    assert [(s['page'],s.get('sheet'),'src' in s) for s in sheets()]==[(1,'night',False),(2,None,True)],sheets()
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': sheet backgrounds and the own picture are set, undone, never selected, copied and exported')

    # 25. Borders (3.11 beta.11): «Рамка» frames the selection (or, with nothing
    #     selected, the cards and boxes of the page); drawn over the edge, so the
    #     text does not move; the colour picker recolours on screen (no rebuild)
    #     as one undo step; a themed card takes the theme's border colour.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    card=lambda i,x,y,**extra:{'id':i,'kind':'card','page':1,'x':x,'y':y,'w':70,'h':25,'z':1,'title':i,'meta':'м','detail':'д','bg':'#ffffff',**extra}
    import_json(page,[card('A',10,30),card('B',100,30,theme='forest'),{'id':'L','kind':'shape','shape':'line','page':1,'x':10,'y':90,'w':50,'h':2,'z':2,'bg':'#8e6eb0'}])
    data=lambda:{i['id']:i for i in saved_layout(page)}
    frame=lambda i,prop:page.locator(f'.el[data-id="{i}"]').evaluate(f'e=>getComputedStyle(e,"::after").{prop}')
    title_box=lambda:page.locator('.el[data-id="A"] .title').evaluate('e=>{const r=e.getBoundingClientRect(),p=e.closest(".el").getBoundingClientRect();return [r.left-p.left,r.top-p.top]}')
    page.locator('[data-tab="appearance"]').click()
    before=title_box()
    page.locator('.el[data-id="A"]').click(position={'x':4,'y':20})
    page.select_option('#outlineStyle','dashed')
    assert data()['A'].get('outline')=='dashed' and 'outline' not in data()['B'],'Only the selection'
    assert frame('A','borderTopStyle')=='dashed' and frame('A','borderTopColor')=='rgb(116, 81, 147)',(frame('A','borderTopStyle'),frame('A','borderTopColor'))
    assert title_box()==before,('The frame does not move the text',before,title_box())
    page.select_option('#outlineWidth','1.2')
    assert data()['A']['outlineWidth']==1.2
    # The colour picker: the same element, recoloured; one undo step for the drag.
    page.evaluate("window.frameNode=document.querySelector('.el[data-id=\"A\"]')")
    for c in ('#aa0000','#b23a3a'):
        page.locator('#outlineColor').evaluate('(e,c)=>{e.value=c;e.dispatchEvent(new Event("input",{bubbles:true}))}',c)
    assert data()['A']['outlineColor']=='#b23a3a' and frame('A','borderTopColor')=='rgb(178, 58, 58)'
    assert page.evaluate("window.frameNode===document.querySelector('.el[data-id=\"A\"]')"),'No rebuild while picking a colour'
    page.locator('#undo').click()
    assert 'outlineColor' not in data()['A'] and data()['A']['outlineWidth']==1.2,('One undo for the colour drag',data()['A'])
    # Nothing selected: the cards of the page, not the line; the theme gives the colour.
    page.locator('#page1').click(position={'x':4,'y':4})
    page.select_option('#outlineStyle','double')
    assert data()['A']['outline']=='double' and data()['B']['outline']=='double' and 'outline' not in data()['L']
    assert frame('B','borderTopColor')=='rgb(141, 180, 135)','A themed card: the theme border colour'
    # The tools show the selection's frame; «Рамку на весь лист»; «Без рамки».
    page.locator('.el[data-id="A"]').click(position={'x':4,'y':20})
    page.select_option('#outlineStyle','corners')
    page.locator('.el[data-id="B"]').click(position={'x':4,'y':20})
    assert page.locator('#outlineStyle').input_value()=='double'
    page.locator('.el[data-id="A"]').click(position={'x':4,'y':20})
    assert page.locator('#outlineStyle').input_value()=='corners' and page.locator('#outlineWidth').input_value()=='1.2'
    page.locator('#outlinePage').click()
    assert data()['B']['outline']=='corners' and data()['B']['outlineWidth']==1.2
    page.select_option('#outlineStyle','')
    assert not any(k.startswith('outline') for k in data()['A']) and data()['B']['outline']=='corners'
    assert frame('A','content')=='none','No frame drawn'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': borders frame the selection or the page; text stays put; colour drag is one undo step')

    # 26. The ribbon (3.11 beta.12): tabs in the top bar, named groups of icon buttons
    #     under them, one fixed height whatever the tab or the selection (the
    #     sheet must not jump), nothing wider than the window at 1280 px.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    import_json(page,[{'id':'A','kind':'card','page':1,'x':10,'y':30,'w':80,'h':25,'z':1,'title':'Лютня','meta':'м','detail':'д','bg':'#ffffff'}])
    toolbar_height=lambda:page.evaluate("document.querySelector('.toolbar').getBoundingClientRect().height")
    tabs=page.eval_on_selector_all('.toolbar-tab','e=>e.map(x=>x.dataset.tab)')
    assert page.locator('.toolbar-top [role="tab"]').count()==8,'The tabs sit in the top bar'
    assert page.locator('#addBadge').is_disabled(),'Badge buttons are greyed out without a card'
    heights=set()
    for selected in (False,True):
        if selected: page.locator('.el[data-id="A"]').click(position={'x':4,'y':20})
        for tab in tabs:
            page.locator(f'[data-tab="{tab}"]').click()
            heights.add(toolbar_height())
            assert page.evaluate('document.documentElement.scrollWidth')<=1280,('The page scrolls sideways',tab,selected)
    assert len(heights)==1,('The toolbar keeps one height',heights)
    assert not page.locator('#addBadge').is_disabled(),'A selected card enables the badge buttons'
    # Every ribbon button and the top bar buttons carry an icon and a label.
    bare=page.evaluate("[...document.querySelectorAll('.rb-large,.rb-small,.rb-top')].filter(e=>!e.querySelector('svg.rb-ico')||!e.querySelector('.rb-label').textContent.trim()).map(e=>e.id)")
    assert not bare,('Buttons without an icon or a label',bare)
    names=page.eval_on_selector_all('#panel-cards .rb-name','e=>e.map(x=>x.textContent)')
    assert names==['Добавить','Правка','Лист','Ресурсы','Закрепление','Фон карточки'],names
    # Renaming a button (lock) keeps its icon.
    page.locator('[data-tab="cards"]').click(); page.locator('#lock').click()
    assert page.locator('#lock .rb-label').inner_text()=='Открепить' and page.locator('#lock svg.rb-ico').count()==1
    # The snapping pill is the checkbox.
    page.locator('#snapTools label').first.click()
    assert not page.locator('#snapToggle').is_checked(),'A click on the magnet pill turns snapping off'
    page.locator('#snapTools label').first.click()
    assert page.locator('#snapToggle').is_checked()
    # «Справка» (beta.16): the guide is a dialog of short sections, not a paragraph under the pages.
    assert page.locator('.stage .help').count()==0,'The long paragraph under the pages is gone'
    page.locator('#help').click()
    assert page.locator('#helpDialog').is_visible()
    titles=page.eval_on_selector_all('#helpDialog h3','e=>e.map(x=>x.textContent)')
    assert len(titles)>=8 and 'Клавиши' in titles,titles
    page.keyboard.press('Escape')
    page.wait_for_function("!document.getElementById('helpDialog').open")
    page.keyboard.press('F1')
    page.wait_for_function("document.getElementById('helpDialog').open")
    page.locator('#helpClose').click()
    page.wait_for_function("!document.getElementById('helpDialog').open")
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': the ribbon keeps one height, icons and labels on every button, fits 1280 px, help dialog opens and closes')

    # 27. Layout format version (3.11 beta.13): the JSON file says {formatVersion, items}
    #     and reads back; an old bare array still opens and is moved to the current
    #     format (the 3.4 badge spot); a newer version is refused, and a browser save
    #     written by a newer editor is neither opened nor overwritten.
    for kind,query in backends:
        context=browser.new_context(accept_downloads=True)
        page=open_editor(context,html_path.as_uri()+query)
        old_card={'id':'old','kind':'card','page':1,'x':10,'y':30,'w':80,'h':25,'title':'Старая','level':'1','badgeX':81.5,'badgeY':1.1}
        import_json(page,[old_card,{**old_card,'id':'moved','y':60,'badgeCustomPosition':True}])
        assert not page.dialogs,page.dialogs
        record=saved_record(page)
        assert record['formatVersion']==3,'The browser save names its format'
        by_id={item['id']:item for item in record['items']}
        assert 'badgeX' not in by_id['old'] and by_id['moved']['badgeX']==81.5,'Format 1 badges are moved, hand-placed ones kept'
        page.locator('#layoutName').fill('Формат')
        with page.expect_download() as downloaded:
            page.locator('#json').click()
        data=json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))
        assert data['format']=='dnd-card-editor/layout' and data['formatVersion']==3 and data['name']=='Формат',{k:v for k,v in data.items() if k!='items'}
        assert data['editor']==json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
        assert [item['id'] for item in data['items']]==['old','moved']
        import_json(page,starter)
        assert page.locator('.el').count()==len(starter)
        page.locator('[data-tab="files"]').click()
        page.set_input_files('#import',{'name':'back.json','mimeType':'application/json','buffer':Path(downloaded.value.path()).read_bytes()})
        page.wait_for_function("document.querySelectorAll('.el').length===2")
        assert not page.dialogs,page.dialogs
        count=len(page.dialogs)
        import_json(page,{**data,'formatVersion':99})
        assert 'более новой версией редактора' in wait_dialog(page,count),page.dialogs
        assert page.locator('.el').count()==2,'A newer file leaves the layout as it was'
        with page.expect_download() as exported_file:
            page.locator('#export').click()
        exported=Path(exported_file.value.path()).read_text(encoding='utf-8')
        assert re.search(r'<script[^>]*id="initial"[^>]*data-format-version="3"',exported),'The HTML file names the format of its layout'
        page.close()
        # A save from a newer editor: this one opens its own template under a new id.
        future={'id':'from-future','name':'Будущий','savedAt':'2999-01-01T00:00:00Z','formatVersion':99,'items':[{'id':'f','kind':'hologram'}]}
        page=open_editor(context,html_path.as_uri()+query)
        put_saved(page,future)
        page.close()
        page=open_editor(context,html_path.as_uri()+query)
        notice=page.locator('.notice[data-notice="tooNew"]')
        assert notice.is_visible() and 'Будущий' in notice.inner_text(),page.locator('#notices').inner_text()
        assert page.evaluate('document.documentElement.dataset.layoutId')!='from-future'
        assert page.locator('.el').count()==len(starter)
        page.locator('.el.card').first.click(position={'x':4,'y':20}); page.keyboard.press('Delete')
        wait_saved(page)
        assert saved_record(page,'from-future')==future,'The newer save is not touched'
        page.locator('[data-tab="files"]').click(); page.locator('#layouts').click()
        page.wait_for_selector('#layoutsDialog[open] li strong')
        with page.expect_download() as raw:
            page.locator('#layoutsDialog li[data-id="from-future"]').get_by_role('button',name='Скачать JSON').click()
        assert json.loads(Path(raw.value.path()).read_text(encoding='utf-8'))=={'formatVersion':99,'items':future['items']},'Downloaded as it is'
        count=len(page.dialogs)
        page.locator('#layoutsDialog li[data-id="from-future"]').get_by_role('button',name='Открыть').click()
        assert 'более новой версией редактора' in wait_dialog(page,count)
        assert page.locator('.el').count()==len(starter)-1,'The open layout stays'
        assert not page.errors,page.errors
        context.close()
        print('PASS '+engine+' '+kind+': layout files name their format version, old ones migrate, newer ones are refused and kept')

    # 28. «Открыть» (3.11 beta.15): a layout file (.dnd) opens as its own layout (its id, name,
    #     a fresh undo history); an editor HTML from any version and a bare JSON open too.
    #     With the File System Access API (stubbed) the opened file becomes the layout's file:
    #     Ctrl+S writes the layout back into it without a dialog, and it is listed under
    #     «Недавние файлы». A save of the same layout made later in this browser wins, the
    #     file's version one click away; a broken file leaves everything as it was.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    page.evaluate('window.showOpenFilePicker=undefined')
    lute={'id':'L','kind':'card','page':1,'x':10,'y':30,'w':80,'h':25,'z':1,'title':'Лютня'}
    dnd={'format':'dnd-card-editor/layout','formatVersion':2,'id':'m-file-1','name':'Ричард из файла','savedAt':'2026-10-20T10:00:00.000Z','items':[lute]}
    def open_with_input(name,text):
        page.keyboard.press('Control+o')
        page.wait_for_selector('#openDialog[open] .open-pick')
        page.set_input_files('#openFileInput',{'name':name,'mimeType':'application/octet-stream','buffer':text.encode('utf-8')})
    import_json(page,starter)
    page.locator('.el.card').first.click(position={'x':4,'y':20}); page.keyboard.press('Delete')
    open_with_input('Ричард.dnd',json.dumps(dnd,ensure_ascii=False))
    page.wait_for_function("document.documentElement.dataset.layoutId==='m-file-1'")
    assert page.locator('.el').count()==1 and page.locator('#layoutName').input_value()=='Ричард из файла'
    assert page.locator('#undo').is_disabled(),'An opened file starts its own undo history'
    assert not page.locator('#openDialog').evaluate('d=>d.open')
    wait_saved(page)
    assert saved_record(page,'m-file-1')['items'][0]['title']=='Лютня','The opened layout is saved under its own id'
    # An editor HTML downloaded earlier opens its layout under its own id.
    page.locator('#layoutName').fill('Из HTML')
    with page.expect_download() as exported_file:
        page.locator('#export').click()
    exported=Path(exported_file.value.path()).read_text(encoding='utf-8')
    # A bare JSON array (any older download) starts a new layout.
    open_with_input('старый.json',json.dumps([lute,{**lute,'id':'L2','y':70}]))
    page.wait_for_function("document.querySelectorAll('.el').length===2")
    assert page.evaluate('document.documentElement.dataset.layoutId')!='m-file-1'
    open_with_input('старый.html',exported)
    page.wait_for_function("document.documentElement.dataset.layoutId==='m-file-1'")
    assert page.locator('.el').count()==1 and page.locator('#layoutName').input_value()=='Из HTML'
    open_with_input('старый.json',json.dumps([lute,{**lute,'id':'L2','y':70}]))
    page.wait_for_function("document.querySelectorAll('.el').length===2")
    # A broken file: a message, nothing changes.
    count=len(page.dialogs)
    open_with_input('битый.dnd','{"items": [}')
    assert 'не открывается' in wait_dialog(page,count)
    assert page.locator('.el').count()==2
    # A later save of the same layout in this browser wins over the older file.
    put_saved(page,{'id':'m-file-1','name':'Ричард','savedAt':'2026-10-24T10:00:00.000Z','formatVersion':2,'items':[{**lute,'title':'Лютня из браузера'}]})
    open_with_input('Ричард.dnd',json.dumps(dnd,ensure_ascii=False))
    page.wait_for_selector('[data-notice="opened"]')
    assert page.locator('.el[data-id="L"] .title').inner_text().strip()=='Лютня из браузера'
    page.locator('[data-notice="opened"]').get_by_role('button',name='Открыть как в файле').click()
    page.wait_for_function("document.querySelector('.el[data-id=\"L\"] .title').innerText.trim()==='Лютня'")
    page.keyboard.press('Control+z')
    page.wait_for_function("document.querySelector('.el[data-id=\"L\"] .title').innerText.trim()==='Лютня из браузера'")
    # With the API: the file picked in «Открыть» is the one Ctrl+S writes into.
    page.evaluate("""data=>{window.files=[];window.picks=[];window.opens=0;
      window.handle={name:'Ричард.dnd',getFile:async()=>new Blob([JSON.stringify(data)]),
        createWritable:async()=>{let text='';return {write:async d=>{text+=d},close:async()=>{window.files.push({name:'Ричард.dnd',text})}}}};
      window.showOpenFilePicker=async()=>{window.opens++;return [window.handle]};
      window.showSaveFilePicker=async options=>{window.picks.push(options.suggestedName);throw new DOMException('no','AbortError')}}""",{**dnd,'id':'m-file-2','savedAt':'2026-10-25T09:00:00.000Z'})
    page.keyboard.press('Control+o')
    page.locator('#openDialog .open-pick').click()
    page.wait_for_function("document.documentElement.dataset.layoutId==='m-file-2'")
    page.wait_for_function("document.querySelector('#fileState').textContent.includes('Ричард.dnd')")
    page.locator('.el[data-id="L"] .title').click()
    page.wait_for_function('document.activeElement?.isContentEditable')
    page.keyboard.press('End'); page.keyboard.type('!')
    page.keyboard.press('Control+s')
    page.wait_for_function('window.files.length===1')
    assert page.evaluate('window.picks')==[],'No save dialog: the opened file is the layout file'
    written=json.loads(page.evaluate('window.files[0].text'))
    assert written['id']=='m-file-2' and written['formatVersion']==3 and written['items'][0]['title']=='Лютня!',written
    # «Недавние файлы» lists it and opens it again.
    page.keyboard.press('Control+o')
    page.wait_for_selector('#openDialog[open] li[data-id="m-file-2"]')
    assert 'Ричард.dnd' in page.locator('#openDialog li[data-id="m-file-2"]').inner_text()
    page.locator('#openDialog li[data-id="m-file-2"]').get_by_role('button',name='Открыть').click()
    page.wait_for_function('!document.querySelector("#openDialog").open')
    assert page.evaluate('window.opens')==1,'A recent file opens without the dialog'
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': «Открыть» opens .dnd, HTML and JSON as their own layout; Ctrl+S writes back into the opened file; recent files')

    # 29. «Новый лист» and ready sheets (3.11 beta.17): a first-time visitor gets the empty
    #     template with a notice; the layout name follows the heading until it is typed; the
    #     ready sheets come from the site (here: routed to library/), a copy opens as a new
    #     layout and the previous one stays in «Мои макеты»; without the site the template
    #     still works and the dialog says why the list is missing.
    from library_site import library_index
    context=browser.new_context(viewport={'width':1280,'height':900})
    online={'on':False}
    def serve_library(route):
        if not online['on']: return route.abort()
        name=route.request.url.split('/library/')[1].split('?')[0]
        from urllib.parse import unquote
        name=unquote(name)
        body=json.dumps(library_index(),ensure_ascii=False) if name=='index.json' else (root/'library'/name).read_text(encoding='utf-8')
        route.fulfill(status=200,content_type='application/json',body=body,headers={'Access-Control-Allow-Origin':'*'})
    context.route('https://valir-song.github.io/dnd-editor/library/**',serve_library)
    page=open_editor(context,welcome=True)
    page.wait_for_selector('.notice[data-notice="welcome"]')
    assert 'ИМЯ ПЕРСОНАЖА' in page.locator('#page1').inner_text() and 'РИЧАРД' not in page.locator('.stage').inner_text()
    assert page.locator('#layoutName').input_value()=='ИМЯ ПЕРСОНАЖА'
    first=page.evaluate('document.documentElement.dataset.layoutId')
    # The player writes the character's name on the sheet: the layout name follows.
    page.locator('.el.header[data-id="e1"] .title .tiptap-content').click()
    page.wait_for_function('document.activeElement?.isContentEditable')
    page.keyboard.press('Control+a'); page.keyboard.type('ГРОМ')
    page.wait_for_function("document.querySelector('#layoutName').value==='ГРОМ'")
    wait_saved(page)
    assert saved_record(page,first)['name']=='ГРОМ'
    page.keyboard.press('Escape')
    # No site: the list says so, the template still starts.
    page.locator('[data-tab="files"]').click()
    page.locator('#newSheet').click()
    page.wait_for_selector('#newSheetDialog[open] .layouts-empty')
    assert 'интернет' in page.locator('#newSheetDialog .layouts-empty').inner_text()
    assert 'ГРОМ' in page.locator('#newSheetDialog .layouts-hint').inner_text()
    # The site answers: «Попробовать ещё раз» shows Richard; a copy opens as a new layout.
    online['on']=True
    page.locator('#newSheetDialog').get_by_role('button',name='Попробовать ещё раз').click()
    row=page.locator('#newSheetDialog li[data-file="richard-sadsong.dnd"]')
    row.wait_for()
    assert 'Бард — Ричард Сэдсонг' in row.inner_text() and 'Бард 6' in row.inner_text()
    row.get_by_role('button',name='Взять за основу').click()
    page.wait_for_function("!document.querySelector('#newSheetDialog').open")
    second=page.evaluate('document.documentElement.dataset.layoutId')
    assert second!=first and 'РИЧАРД СЭДСОНГ' in page.locator('#page1').inner_text()
    assert page.locator('.el').count()==28 and page.locator('#layoutName').input_value()=='Бард — Ричард Сэдсонг'
    assert page.locator('#undo').is_disabled(),'A new sheet starts its own undo history'
    assert page.locator('.notice[data-notice="welcome"]').count()==0
    wait_saved(page)
    assert saved_record(page,second)['name']=='Бард — Ричард Сэдсонг' and len(saved_record(page,second)['items'])==28
    assert saved_record(page,first)['name']=='ГРОМ','The previous sheet stays saved'
    # A typed name stays when the heading changes.
    page.locator('#layoutName').fill('Мой бард')
    page.locator('.el.header[data-id="e1"] .title .tiptap-content').click()
    page.wait_for_function('document.activeElement?.isContentEditable')
    page.keyboard.press('End'); page.keyboard.type(' II')
    page.keyboard.press('Escape')
    wait_saved(page)
    assert saved_record(page,second)['name']=='Мой бард'
    # «Начать с нуля»: the template again, as a third layout.
    page.locator('#newSheet').click()
    page.locator('#newSheetDialog').get_by_role('button',name='Начать с нуля').click()
    page.wait_for_function("!document.querySelector('#newSheetDialog').open")
    third=page.evaluate('document.documentElement.dataset.layoutId')
    assert third not in (first,second) and page.locator('.el').count()==len(starter)
    assert page.locator('#layoutName').input_value()=='ИМЯ ПЕРСОНАЖА'
    # All three are in «Мои макеты»; the first opens again with its name.
    page.locator('#layouts').click()
    page.wait_for_selector('#layoutsDialog[open] li[data-id="'+first+'"]')
    for id in (first,second):
        assert page.locator('#layoutsDialog li[data-id="'+id+'"]').count()==1
    page.locator('#layoutsDialog li[data-id="'+first+'"]').get_by_role('button',name='Открыть').click()
    page.wait_for_function('document.documentElement.dataset.layoutId===%s'%json.dumps(first))
    assert page.locator('#layoutName').input_value()=='ГРОМ' and 'ГРОМ' in page.locator('#page1').inner_text()
    # A returning player opens the last sheet, without the welcome notice.
    again=open_editor(context,welcome=True)
    assert again.locator('.notice[data-notice="welcome"]').count()==0
    assert not page.errors and not again.errors,(page.errors,again.errors)
    context.close()
    print('PASS '+engine+': empty template for newcomers, «Новый лист» from the template or a ready sheet, the name follows the heading')
    # 30. Resources (3.11 beta.18): the template's typed «□» became rows; a click on a box
    #     spends it, a second click gives it back; «+» above a row adds a box; the row name is
    #     typed in place; «Круг»/«Ресурс» add rows to the selected box, «Ресурсы» a new box;
    #     «Короткий отдых» gives back only КО rows, «Длинный отдых» КО and ДО. Undo works.
    context=browser.new_context(viewport={'width':1280,'height':900})
    page=open_editor(context)
    # Richard's sheet from the library: its resources were typed as «□» (format 2).
    import_json(page,json.loads((root/'library'/'richard-sadsong.dnd').read_text(encoding='utf-8')))
    box_id=page.evaluate("document.querySelector('.el.resources').dataset.id")
    box=lambda:page.locator('.el[data-id="'+box_id+'"]')
    row=lambda col,n:box().locator('.pool-col[data-col="'+str(col)+'"] .pool').nth(n)
    pools=lambda:next(item for item in saved_layout(page) if item['id']==box_id)['pools']
    assert box().locator('.pool').count()==8 and '□' not in box().inner_text(),box().inner_text()
    assert row(0,1).locator('.pool-label').inner_text()=='1 круг' and row(0,1).locator('.pool-cell').count()==4
    assert row(1,0).locator('.pool-label').inner_text()=='Лютня' and row(1,0).locator('.pool-cell').count()==8
    row(0,1).locator('.pool-cell').nth(2).click()
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===3")
    row(0,1).locator('.pool-cell').nth(1).click()
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===1")
    assert [p['used'] for p in pools()][:4]==[0,0,1,0] or pools()[2]['used']==1,pools()
    page.keyboard.press('Control+z')
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===3")
    # The box is selected now: «+» over a row adds a box; the tools never print.
    row(1,0).hover()
    tools=row(1,0).locator('.pool-tools')
    assert tools.is_visible()
    tools.get_by_title('Добавить ячейку').click()
    page.wait_for_function("document.querySelector('.el.resources .pool-col[data-col=\"1\"] .pool').querySelectorAll('.pool-cell').length===9")
    # A long row wraps its boxes under its own first box: the next row keeps its left edge.
    for _ in range(8):
        row(1,0).hover(); row(1,0).locator('.pool-tools').get_by_title('Добавить ячейку').click()
    page.wait_for_function("document.querySelector('.el.resources .pool-col[data-col=\"1\"] .pool').querySelectorAll('.pool-cell').length===17")
    lefts=page.evaluate("""()=>{const r=document.querySelector('.el.resources .pool-col[data-col="1"] .pool');const c=[...r.querySelectorAll('.pool-cell')].map(x=>x.getBoundingClientRect());
      return {rows:new Set(c.map(x=>Math.round(x.top))).size,first:c[0].left,wrapped:Math.min(...c.filter(x=>x.top>c[0].top+1).map(x=>x.left)),next:r.nextElementSibling.getBoundingClientRect().top,bottom:Math.max(...c.map(x=>x.bottom))}}""")
    assert lefts['rows']>=2 and abs(lefts['first']-lefts['wrapped'])<0.5 and lefts['next']>=lefts['bottom']-0.5,lefts
    # The name is typed in place, as one undo step, without rebuilding the box.
    label=row(1,1).locator('.pool-label')
    label.click()
    page.wait_for_function('document.activeElement?.classList.contains("pool-label")')
    page.keyboard.press('End'); page.keyboard.type('!'); page.keyboard.press('Enter')
    assert label.inner_text()=='Чарующая магия!'
    page.wait_for_function("document.documentElement.dataset.saveState==='saved'")
    assert pools()[3]['label']=='Чарующая магия!',pools()
    # A rest: Лютня is ДО; make it КО, spend one box of Лютня and one of «2 круг» (ДО).
    page.keyboard.press('Escape')
    row(1,0).locator('.pool-rest').click()
    page.wait_for_function("document.querySelector('.el.resources .pool-col[data-col=\"1\"] .pool .pool-rest').textContent==='КО'")
    row(1,0).locator('.pool-cell').nth(0).click()
    row(0,2).locator('.pool-cell').nth(0).click()
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===5")
    page.locator('[data-tab="cards"]').click()
    page.locator('#shortRest').click()
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===4")
    page.locator('#longRest').click()
    page.wait_for_function("document.querySelectorAll('.el.resources .pool-cell.used').length===0")
    # New rows on the selected box, a new box from the ribbon.
    box().click(position={'x':4,'y':4})
    page.locator('#addSpellRow').click()
    page.wait_for_function("[...document.querySelectorAll('.el.resources .pool-label')].some(x=>x.textContent==='4 круг')")
    page.locator('#addResources').click()
    page.wait_for_function("document.querySelectorAll('.el.resources').length===2")
    assert page.locator('#addExtraRow').is_enabled()
    page.locator('#addExtraRow').click()
    page.wait_for_function("[...document.querySelectorAll('.el.resources')].at(-1).querySelectorAll('.pool').length===3")
    # Print: no tools, filled boxes keep their colour.
    page.emulate_media(media='print')
    assert page.evaluate("[...document.querySelectorAll('.pool-tools')].every(x=>getComputedStyle(x).display==='none')")
    page.emulate_media(media='screen')
    assert not page.errors,page.errors
    page.wait_for_function("document.documentElement.dataset.saveState!=='saving'")
    context.close()
    print('PASS '+engine+': resources — rows from typed boxes, spend/give back, +/− boxes, names, rests, new box and rows')

    # 31. Spell reference (3.11 beta.19): «Заклинание…» loads library/spells.json from the site
    #     (here: routed); without the site the dialog says why. Search, class, circle, «Моя СЛ» and
    #     ticks make cards in one undo step: badge = circle, «1 круг · основное · 60 фт. · мгновенно», the summary with
    #     the DC, the full text inside the card; «📖» shows it, does not drag, never prints.
    context=browser.new_context(viewport={'width':1280,'height':900})
    online={'on':False}
    def serve_spells(route):
        if not online['on']: return route.abort()
        name=route.request.url.split('/library/')[1].split('?')[0]
        route.fulfill(status=200,content_type='application/json',body=(root/'library'/name).read_text(encoding='utf-8'),headers={'Access-Control-Allow-Origin':'*'})
    context.route('https://valir-song.github.io/dnd-editor/library/**',serve_spells)
    page=open_editor(context)
    page.evaluate("localStorage.removeItem('dnd-card-editor-spell-dc');localStorage.removeItem('dnd-card-editor-spell-class')")
    before=page.locator('.el').count()
    page.locator('[data-tab="cards"]').click()
    page.locator('#addSpell').click()
    page.wait_for_selector('#spellDialog[open] .layouts-empty')
    assert 'интернет' in page.locator('#spellDialog .layouts-empty').inner_text()
    online['on']=True
    page.locator('#spellDialog').get_by_role('button',name='Попробовать ещё раз').click()
    page.wait_for_selector('#spellDialog li[data-spell]')
    assert page.locator('#spellDialog li[data-spell]').count()==339,'the whole SRD by default'
    # The class filter: a bard sees the bard list; the subclasses of the group use the wizard's.
    assert 'Воин — Мистический рыцарь' in page.locator('.spell-class').evaluate("e=>[...e.options].map(o=>o.text).join('|')")
    page.select_option('.spell-class','bard')
    page.wait_for_function("document.querySelectorAll('#spellDialog li[data-spell]').length===130")
    assert page.locator('.spell-insert').is_disabled()
    page.fill('.spell-search','шепот')
    page.wait_for_function("document.querySelectorAll('#spellDialog li[data-spell]').length===1")
    page.fill('.spell-dc','14')
    whisper=page.locator('#spellDialog li[data-spell="dissonant-whispers"]')
    assert 'Мудрость СЛ 14.' in whisper.inner_text() and '1 круг · основное · 60 фт. · мгновенно' in whisper.inner_text() and 'Dissonant Whispers' in whisper.inner_text()
    # The original name is shown and searched: a translation that differs is still found.
    page.fill('.spell-search','shatter')
    page.wait_for_function("document.querySelectorAll('#spellDialog li[data-spell]').length===1")
    assert 'Разбивающий звук' in page.locator('#spellDialog li[data-spell="shatter"]').inner_text()
    page.fill('.spell-search','шепот')
    page.wait_for_function("document.querySelectorAll('#spellDialog li[data-spell]').length===1")
    whisper.locator('input').check()
    # A tick survives a new search; the circle filter narrows the list.
    page.fill('.spell-search','')
    page.select_option('.spell-level','0')
    page.wait_for_function("document.querySelectorAll('#spellDialog li[data-spell]').length===10")
    page.locator('#spellDialog li[data-spell="vicious-mockery"] input').check()
    assert page.locator('.spell-insert').inner_text()=='Вставить (2)'
    page.locator('.spell-insert').click()
    page.wait_for_function("!document.querySelector('#spellDialog').open")
    page.wait_for_function('document.querySelectorAll(".el.card .spell-info").length===2')
    wait_saved(page)
    cards=[item for item in saved_layout(page) if item.get('spellId')]
    assert [c['spellId'] for c in cards]==['vicious-mockery','dissonant-whispers'],cards
    whisper_card=cards[1]
    assert whisper_card['title']=='Диссонирующий шёпот' and whisper_card['level']=='1' and whisper_card['meta']=='1 круг · основное · 60 фт. · мгновенно',whisper_card
    assert whisper_card['detail'].startswith('Мудрость СЛ 14. 3к6'),whisper_card['detail']
    assert 'Ячейкой выше' in whisper_card['spellText'] and cards[0]['level']=='0'
    assert page.locator('.el.selected').count()==2,'the new cards are selected'
    # «📖»: the full text, without moving the card.
    node=page.locator('.el[data-id="'+whisper_card['id']+'"]')
    left=node.evaluate('e=>e.style.left')
    node.locator('.spell-info').click()
    page.wait_for_selector('#spellInfoDialog[open]')
    info=page.locator('#spellInfoDialog').inner_text()
    assert 'Диссонирующий шёпот [Dissonant Whispers] — 1-й круг, очарование' in info and 'Время:' in info and 'Классы: бард' in info and 'CC-BY 4.0' in info,info
    assert page.locator('#spellInfoDialog b').count()>=4,'bold labels'
    page.keyboard.press('Escape')
    page.wait_for_function("!document.querySelector('#spellInfoDialog').open")
    assert node.evaluate('e=>e.style.left')==left
    # The DC is remembered for the next time; the reference is loaded once.
    page.locator('#addSpell').click()
    page.wait_for_selector('#spellDialog li[data-spell]')
    assert page.locator('.spell-dc').input_value()=='14' and page.locator('.spell-class').input_value()=='bard'
    page.locator('#spellDialog').get_by_role('button',name='Закрыть').click()
    # Print: no «📖»; one Ctrl+Z takes both cards back.
    page.emulate_media(media='print')
    assert page.evaluate("[...document.querySelectorAll('.spell-info')].every(x=>getComputedStyle(x).display==='none')")
    page.emulate_media(media='screen')
    page.locator('#page1').click(position={'x':5,'y':5})
    page.keyboard.press('Control+z')
    page.wait_for_function('n=>document.querySelectorAll(".el").length===n',arg=before)
    assert not page.errors,page.errors
    page.wait_for_function("document.documentElement.dataset.saveState!=='saving'")
    context.close()
    print('PASS '+engine+': spell reference — load from the site, search, circle, «Моя СЛ», cards in one step, «📖» full text')


    # 32. Sheet zoom (4.1): buttons in the corner, Ctrl+wheel keeps the point under the cursor,
    #     Ctrl+0; drag, resize and handles measure millimetres at any zoom; text still takes
    #     a click and keys; the zoom is remembered per browser, never printed or exported.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    page.evaluate("localStorage.removeItem('dnd-card-editor-zoom')")
    page.reload(); page.wait_for_selector('.el .tiptap-content')
    if page.locator('.notice[data-notice="welcome"]').count(): page.locator('.notice[data-notice="welcome"] .notice-close').click()
    zoom=lambda: int(page.evaluate('document.documentElement.dataset.zoom'))
    width=lambda: page.locator('#page1').evaluate('e=>e.getBoundingClientRect().width')
    assert zoom()==100 and page.locator('#zoomValue').inner_text()=='100 %'
    base=width()
    for _ in range(3): page.locator('#zoomIn').click()
    assert zoom()==150 and abs(width()-base*1.5)<1,(zoom(),width(),base)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'150 % still fits 1280 px without a sideways scroll'
    # Drag 60×30 screen px without snapping: the card moves 60×30 px of the zoomed page in mm.
    card=page.locator('.page[data-page="1"] .el.card').first
    card.scroll_into_view_if_needed()
    card_id=card.get_attribute('data-id')
    geometry=lambda: card.evaluate("e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top),w:parseFloat(e.style.width)})")
    before=geometry()
    box=card.bounding_box()
    page.mouse.move(box['x']+6,box['y']+30); page.mouse.down(); page.keyboard.down('Alt')
    page.mouse.move(box['x']+36,box['y']+45,steps=4); page.mouse.move(box['x']+66,box['y']+60,steps=4)
    page.mouse.up(); page.keyboard.up('Alt')
    after=geometry()
    k=210/width()
    assert abs(after['x']-before['x']-60*k)<0.4 and abs(after['y']-before['y']-30*k)<0.4,(before,after,k)
    # Handles keep their screen size and sit on the card's corner.
    assert handle_offset(page,card)<2
    size=page.evaluate("""()=>{const h=[...document.querySelectorAll('.gesture-frame:not([hidden]) [data-dir="se"]')].map(n=>n.getBoundingClientRect()).find(r=>r.width>0);return h.width}""")
    assert abs(size-10)<1,size
    # Resize by the corner: 45 screen px wider.
    h=page.locator('.gesture-frame:not([hidden]) [data-dir="se"]').first.bounding_box()
    page.mouse.move(h['x']+h['width']/2,h['y']+h['height']/2); page.mouse.down(); page.keyboard.down('Alt')
    page.mouse.move(h['x']+h['width']/2+45,h['y']+h['height']/2,steps=5); page.mouse.up(); page.keyboard.up('Alt')
    resized=geometry()
    assert abs(resized['w']-after['w']-45*k)<0.4,(after,resized,k)
    # Ctrl+wheel: smaller, and the sheet point under the cursor stays under it (vertically:
    # a page narrower than the window is centred, there is nothing to scroll sideways).
    r=page.locator('#page1').bounding_box()
    point=(r['x']+300,min(r['y']+r['height']-50,500))
    mm=page.evaluate('([x,y])=>{const r=document.querySelector("#page1").getBoundingClientRect();return [(x-r.left)*210/r.width,(y-r.top)*210/r.width]}',list(point))
    page.mouse.move(*point); page.keyboard.down('Control'); page.mouse.wheel(0,200); page.keyboard.up('Control')
    page.wait_for_function('document.documentElement.dataset.zoom!=="150"')
    page.evaluate("()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
    assert zoom()<150
    back=page.evaluate('([x,y])=>{const r=document.querySelector("#page1").getBoundingClientRect();return [r.left+x*r.width/210,r.top+y*r.width/210]}',mm)
    assert abs(back[1]-point[1])<3,(point,back)
    assert handle_offset(page,card)<2,'the frame follows the zoom'
    # 50 %: the minus button stops; a click in text still edits it.
    for _ in range(9):
        if page.locator('#zoomOut').is_enabled(): page.locator('#zoomOut').click()
    assert zoom()==50 and page.locator('#zoomOut').is_disabled()
    title=page.locator('.page[data-page="1"] .el.card').nth(1).locator('.title .tiptap-content')
    title.click()
    page.wait_for_function('document.activeElement && document.activeElement.closest(".title")')
    page.keyboard.press('End'); page.keyboard.type('Ж')
    page.wait_for_function('t=>t.textContent.endsWith("Ж")',arg=title.element_handle())
    # Remembered after a reload; Ctrl+0 is 100 %.
    page.locator('#page1').click(position={'x':5,'y':5})
    page.reload(); page.wait_for_selector('.el .tiptap-content')
    assert zoom()==50 and page.locator('#zoomValue').inner_text()=='50 %'
    page.keyboard.press('Control+0')
    assert zoom()==100
    page.locator('#zoomFit').click()
    assert zoom()>100 and page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'«по ширине» fills the window, no sideways scroll'
    # Not printed: the paper is always A4 at 100 %.
    page.emulate_media(media='print')
    assert page.evaluate("getComputedStyle(document.querySelector('.stage')).zoom")=='1'
    assert page.locator('#zoomTools').evaluate('e=>getComputedStyle(e).display')=='none'
    page.emulate_media(media='screen')
    # Not exported: the downloaded file opens at the reader's own zoom.
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as downloaded:
        page.locator('#export').click()
    text=Path(downloaded.value.path()).read_text(encoding='utf-8')
    assert re.search(r'<main class="stage">',text),'no zoom on the exported stage'
    assert not page.errors,page.errors
    page.evaluate("localStorage.removeItem('dnd-card-editor-zoom')")
    context.close()
    print('PASS '+engine+': zoom — corner buttons, Ctrl+wheel around the cursor, Ctrl+0, gestures and text at any zoom, remembered, not printed or exported')


    # 33. More pages (4.2): «+ Добавить лист», bars over each sheet (up, down, copy, delete with a question),
    #     «На лист» for the selection; gestures work on new sheets; a card keeps its look on another page;
    #     each step is one Ctrl+Z; every sheet prints, the bars do not; the exported file opens with all sheets.
    context=browser.new_context(viewport={'width':1280,'height':900},accept_downloads=True)
    page=open_editor(context)
    sheets=lambda: page.locator('.stage > .page').count()
    titles=lambda: page.locator('.page-bar-title').all_inner_texts()
    assert sheets()==2 and titles()==['Лист 1 из 2','Лист 2 из 2'],titles()
    assert page.locator('.page-bar').first.locator('[data-action="up"]').is_disabled()
    page.locator('.page-add').click()
    page.wait_for_function('document.querySelectorAll(".stage > .page").length===3')
    assert titles()==['Лист 1 из 3','Лист 2 из 3','Лист 3 из 3'] and page.locator('.gesture-layer').count()==3
    assert page.locator('#page3 .page-number').inner_text()=='3 / 3' and page.locator('#page1 .page-number').inner_text()=='1 / 3'
    wait_saved(page)
    assert max(i['page'] for i in saved_layout(page))==3,'the empty sheet is kept in the layout'
    # «На лист»: a page-1 card goes to sheet 3, same place, selected, still compact.
    card=page.locator('#page1 .el.card').first
    card_id=card.get_attribute('data-id')
    node=page.locator('.el[data-id="'+card_id+'"]')
    before=node.evaluate("e=>[e.style.left,e.style.top,getComputedStyle(e.querySelector('.meta')).fontSize]")
    page.locator('#page1').click(position={'x':5,'y':5})
    page.locator('[data-tab="cards"]').click()
    assert page.locator('#toPage').is_disabled(),'nothing selected'
    card.click(position={'x':4,'y':20})
    page.wait_for_function('!document.querySelector("#toPage").disabled')
    assert page.locator('#toPage option[value="1"]').evaluate('o=>o.disabled'),'its own sheet is not offered'
    page.select_option('#toPage','3')
    page.wait_for_function('id=>document.querySelector(".el[data-id=\'"+id+"\']").closest(".page").id==="page3"',arg=card_id)
    assert node.evaluate("e=>[e.style.left,e.style.top,getComputedStyle(e.querySelector('.meta')).fontSize]")==before,'same place, same look'
    assert node.evaluate("e=>e.classList.contains('selected')") and page.locator('.gesture-layer[data-page="3"] .gesture-frame:not([hidden])').count()==1
    wait_saved(page)
    moved=next(i for i in saved_layout(page) if i['id']==card_id)
    assert moved['page']==3 and moved['cardLook']=='compact',moved
    # Gestures on the new sheet: drag 40 px.
    left=node.evaluate('e=>parseFloat(e.style.left)')
    box=node.bounding_box()
    page.mouse.move(box['x']+6,box['y']+20); page.mouse.down(); page.keyboard.down('Alt')
    page.mouse.move(box['x']+26,box['y']+20,steps=3); page.mouse.move(box['x']+46,box['y']+20,steps=3)
    page.mouse.up(); page.keyboard.up('Alt')
    k=210/page.locator('#page3').evaluate('e=>e.getBoundingClientRect().width')
    assert abs(node.evaluate('e=>parseFloat(e.style.left)')-left-40*k)<0.4
    assert handle_offset(page,node)<2,'handles on sheet 3'
    # Up: sheet 3 becomes sheet 2 (the card with it); Ctrl+Z puts it back.
    page.locator('.page-bar').nth(2).locator('[data-action="up"]').click()
    page.wait_for_function('id=>document.querySelector(".el[data-id=\'"+id+"\']").closest(".page").id==="page2"',arg=card_id)
    page.locator('#page1').click(position={'x':5,'y':5})
    page.keyboard.press('Control+z')
    page.wait_for_function('id=>document.querySelector(".el[data-id=\'"+id+"\']").closest(".page").id==="page3"',arg=card_id)
    # Copy of sheet 3: a new sheet 4 with a copy of the card.
    page.locator('.page-bar').nth(2).locator('[data-action="copy"]').click()
    page.wait_for_function('document.querySelectorAll(".stage > .page").length===4')
    assert page.locator('#page4 .el.card').count()==1 and page.locator('#page4 .el.card').get_attribute('data-id')!=card_id
    # Deleting the only object of the last sheet keeps the sheet.
    page.locator('#page4 .el.card').click(position={'x':4,'y':20})
    page.keyboard.press('Delete')
    page.wait_for_function('!document.querySelector("#page4 .el")')
    assert sheets()==4,'an emptied sheet stays'
    # Delete sheet 3: asked first (one object), then gone; Ctrl+Z brings it back.
    page.dialogs.clear()
    page.locator('.page-bar').nth(2).locator('[data-action="remove"]').click()
    page.wait_for_function('document.querySelectorAll(".stage > .page").length===3')
    assert page.dialogs and 'объекты на нём (1)' in page.dialogs[-1],page.dialogs
    assert node.count()==0 and page.locator('.gesture-layer').count()==3 and titles()[-1]=='Лист 3 из 3'
    page.keyboard.press('Control+z')
    page.wait_for_function('document.querySelectorAll(".stage > .page").length===4')
    assert node.count()==1 and page.locator('.gesture-layer').count()==4
    # Print: every sheet, no bars, no «+ Добавить лист».
    page.emulate_media(media='print')
    assert page.evaluate("[...document.querySelectorAll('.page-bar,.page-add')].every(e=>getComputedStyle(e).display==='none')")
    assert page.evaluate("[...document.querySelectorAll('.stage > .page')].every(e=>getComputedStyle(e).display!=='none')")
    assert page.locator('#page4').evaluate('e=>getComputedStyle(e).breakAfter')=='auto','no blank sheet after the last one'
    page.emulate_media(media='screen')
    # The exported file opens with its four sheets.
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as downloaded:
        page.locator('#export').click()
    folder=Path(tempfile.mkdtemp(prefix='dnd-pages-'))
    exported=folder/'pages.html'
    shutil.copy2(downloaded.value.path(),exported)
    assert not page.errors,page.errors
    page.close()
    page=open_editor(context,exported.as_uri())
    assert page.locator('.stage > .page').count()==4 and page.locator('#page3 .el[data-id="'+card_id+'"]').count()==1
    assert page.locator('.gesture-layer').count()==4
    assert not page.errors,page.errors
    context.close()
    print('PASS '+engine+': more sheets — add, move, copy, delete with undo, «На лист», gestures on new sheets, print and export')

    browser.close()
print('All regression checks passed for '+engine)
