"""End-to-end regression tests against the ACTUAL Vite-built standalone HTML.
Exercise all text surfaces with real keyboard interactions in Chromium/Firefox.
"""
import os
import json
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_env import launch

html_path=Path(__file__).resolve().parents[1]/'dist'/'index.html'
assert html_path.exists(), 'Build the standalone HTML before running this test'
html=html_path.read_text(encoding='utf-8')
assert 'https://cdn.' not in html and '<script src=' not in html, 'Standalone must not load external scripts'
engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
with sync_playwright() as p:
    browser=launch(p)
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(html_path.as_uri(),wait_until='load')
    page.wait_for_selector('.el .tiptap-content')
    assert page.locator('[role="tab"]').count()==8, errors  # 3.11 added «Выравнивание» and «Кружочки»
    assert page.locator('.el.card').count()>=10  # the empty template: 10 cards
    assert page.locator('.el .tiptap-content').count()>40
    assert page.locator('.el.textbox').count()==0
    for selector in ['.header .title .tiptap-content','.card .title .tiptap-content','.card .meta .tiptap-content','.card .detail .tiptap-content','.note .detail .tiptap-content']:
        assert page.locator(selector).count()>0, selector
    print('PASS '+engine+': all existing card, heading and note fields use Tiptap')

    def focus_editor(locator):
        # Clicking selects the parent object first; on a slow runner the editor
        # can receive focus a moment later, so wait before sending keys.
        locator.click()
        for _ in range(50):  # the locator re-resolves, so redraws do not matter
            if locator.evaluate('e=>e.contains(document.activeElement)'):
                return
            page.wait_for_timeout(100)
        raise AssertionError('Editor did not receive focus after click')
    # Act on a real text selection; do not call editor commands from the test.
    page.locator('[data-tab="text"]').click()
    title=page.locator('.el.card .title .tiptap-content').first
    focus_editor(title)
    title.press('Home')
    title.press('Control+Shift+ArrowRight')
    # A loaded runner can apply the selection a frame later than the key press returns.
    try: page.wait_for_function('getSelection().toString().trim().length>0',timeout=5000)
    except Exception: pass  # the assert below says what went wrong
    selected=page.evaluate('getSelection().toString()')
    assert selected.strip(), 'Keyboard selection must select existing text'
    size=page.locator('#fontSize')
    # Spinner focus has historically made the actual glyph size lag behind.
    size.click()
    starting=int(float(size.input_value()))
    size.press('ArrowUp')
    assert int(float(size.input_value()))==starting+1, 'Spinner failed'
    def marked():
        return title.evaluate("""e=>{
            const nodes=[...e.querySelectorAll('[style*="font-size"]')];
            return nodes.map(n=>({text:n.textContent,px:parseFloat(getComputedStyle(n).fontSize),
                                 top:n.getBoundingClientRect().top,height:n.getBoundingClientRect().height}))
        }""")
    first=marked()
    assert first and any(v['px']>(starting*4/3)+.5 for v in first),('First spinner must change existing glyphs immediately',first,starting)
    size.press('ArrowUp')
    second=marked()
    assert max(x['px'] for x in second)>max(x['px'] for x in first),'Second spinner must update glyphs immediately'
    assert page.evaluate('document.activeElement.id')=='fontSize','Numeric field lost keyboard focus'
    size.fill('23')
    third=marked()
    assert any(abs(x['px']-23*4/3)<1 for x in third),'Manual 23pt entry did not change existing text'
    assert size.input_value()=='23'
    assert not errors,errors
    print('PASS '+engine+': selection, live font-size spinner and direct 23pt entry')

    # Re-select the existing formatted word: toolbar must read its actual mark.
    focus_editor(title)
    title.press('Home')
    title.press('Control+Shift+ArrowRight')
    # The toolbar follows the selection a frame later: wait instead of reading once (CI once read it too early).
    try: page.wait_for_function("Number(document.querySelector('#fontSize').value)>=22.5",timeout=3000)
    except Exception: raise AssertionError(('Displayed size not restored',size.input_value()))
    # Track undo/redo including Cyrillic physical keyboard shortcuts.
    page.evaluate("""() => document.dispatchEvent(new KeyboardEvent('keydown',
      {key:'я',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}))""")
    assert page.locator('#redo').is_enabled()
    page.evaluate("""() => document.dispatchEvent(new KeyboardEvent('keydown',
      {key:'н',code:'KeyY',ctrlKey:true,bubbles:true,cancelable:true}))""")
    print('PASS '+engine+': stored font mark and Cyrillic undo/redo')

    # Tiptap must also be the editor behind independent text boxes.
    page.locator('#addTextBox').click()
    box=page.locator('.el.textbox').last
    assert box.locator('.tiptap-content').count()==1
    field=box.locator('.tiptap-content')
    focus_editor(field)
    field.press('Control+a')
    page.keyboard.type('Tiptap unified example')
    assert 'Tiptap unified example' in field.inner_text()
    assert page.locator('#boxBorderVisible').is_visible()
    page.locator('#boxBorderVisible').check()
    assert 'border' in box.get_attribute('style')
    focus_editor(field)
    size.fill('20')
    assert field.locator('[style*="font-size"]').count()>0
    focus_editor(field)
    assert abs(float(size.input_value())-20)<.6,'Text box loses saved size when reselected'
    page.locator('[data-tab="layers"]').click()
    page.locator('#front').click()
    assert page.locator('.el.textbox').count()==1
    print('PASS '+engine+': same Tiptap controls for independent text boxes and layers')

    # Ensure standalone HTML export carries the library AND edited content.
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as downloaded:
        page.locator('#export').click()
    download=downloaded.value
    assert download.suggested_filename.endswith('.html')
    export_file=Path(download.path())
    exported=export_file.read_text(encoding='utf-8')
    # Playwright stores downloads under an extensionless GUID. Opening that
    # directly as file:// can be treated as binary instead of HTML in Chromium.
    # Restore the actual .html extension before validating the exported app.
    opened_path=Path(tempfile.mkdtemp(prefix='dnd-tiptap-export-'))/'exported.html'
    shutil.copy2(export_file,opened_path)
    assert 'Tiptap unified example' in exported
    reopen=context.new_page()
    reopen_errors=[]
    reopen.on('pageerror',lambda error:reopen_errors.append(str(error)))
    reopen.goto(opened_path.as_uri(),wait_until='load')
    reopen.wait_for_selector('.el .tiptap-content')
    assert reopen.locator('.el.textbox .tiptap-content').count()==1,reopen_errors
    assert 'Tiptap unified example' in reopen.locator('.el.textbox').inner_text()
    reopen.locator('[data-tab="text"]').click()
    reopen.locator('.el.textbox .tiptap-content').click()
    assert abs(float(reopen.locator('#fontSize').input_value())-20)<.6
    assert not reopen_errors,reopen_errors
    print('PASS '+engine+': exported HTML reopens with full offline text editing')

    # Old 3.1/3.2 JSON files should import without changing card positions,
    # losing text content, or dropping legacy <font> typography.
    old=json.loads((html_path.parent.parent/'src'/'starter-layout.json').read_text(encoding='utf-8'))
    old_card=next(item for item in old if item['kind']=='card')
    old_card['title']='Старый заголовок'
    old_card['titleHtml']='<font face="Verdana" color="#a03459" style="font-size:17pt"><b>Старый заголовок</b></font>'
    old[old.index(old_card)]=old_card
    reopen.locator('[data-tab="files"]').click()
    reopen.set_input_files('#import',{'name':'legacy-layout.json',
      'mimeType':'application/json','buffer':json.dumps(old,ensure_ascii=False).encode('utf-8')})
    legacy_title=reopen.locator('.el.card .title .tiptap-content').first
    reopen.wait_for_function('document.querySelector(".el.card .title .tiptap-content")?.textContent.includes("Старый заголовок")')
    assert 'Старый заголовок' in legacy_title.inner_text()
    assert legacy_title.locator('strong').count()>0
    legacy_size=legacy_title.evaluate("""e=>{
      const span=e.querySelector('[style*=font-size]');
      return span?parseFloat(getComputedStyle(span).fontSize):0
    }""")
    assert abs(legacy_size-17*4/3)<1.1,('Legacy 17pt font was lost',legacy_size)
    assert not reopen_errors,reopen_errors
    print('PASS '+engine+': legacy JSON import and HTML font styles')

    assert not errors,errors
    browser.close()
print('All Tiptap end-to-end checks passed for '+engine)
