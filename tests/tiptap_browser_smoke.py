"""End-to-end regression tests against the ACTUAL Vite-built standalone HTML.
Exercise all text surfaces with real keyboard interactions in Chromium/Firefox.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

html_path=Path(__file__).resolve().parents[1]/'dist'/'index.html'
assert html_path.exists(), 'Build the standalone HTML before running this test'
html=html_path.read_text(encoding='utf-8')
assert 'https://cdn.' not in html and '<script src=' not in html, 'Standalone must not load external scripts'
engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
with sync_playwright() as p:
    launcher=getattr(p,engine)
    browser=launcher.launch(headless=True,args=['--no-sandbox'] if engine=='chromium' else [])
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(html_path.as_uri(),wait_until='load')
    page.wait_for_selector('.el .tiptap-content')
    assert page.locator('[role="tab"]').count()==6, errors
    assert page.locator('.el.card').count()>10
    assert page.locator('.el .tiptap-content').count()>40
    assert page.locator('.el.textbox').count()==0
    for selector in ['.header .title .tiptap-content','.card .title .tiptap-content','.card .meta .tiptap-content','.card .detail .tiptap-content','.note .detail .tiptap-content']:
        assert page.locator(selector).count()>0, selector
    print('PASS '+engine+': all existing card, heading and note fields use Tiptap')

    # Act on a real text selection; do not call editor commands from the test.
    page.locator('[data-tab="text"]').click()
    title=page.locator('.el.card .title .tiptap-content').first
    title.click()
    title.press('Home')
    title.press('Control+Shift+ArrowRight')
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
    title.click()
    title.press('Home')
    title.press('Control+Shift+ArrowRight')
    assert float(size.input_value())>=22.5, ('Displayed size not restored',size.input_value())
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
    field.click()
    field.press('Control+a')
    page.keyboard.type('Tiptap unified example')
    assert 'Tiptap unified example' in field.inner_text()
    assert page.locator('#boxBorderVisible').is_visible()
    page.locator('#boxBorderVisible').check()
    assert 'border' in box.get_attribute('style')
    field.click()
    size.fill('20')
    assert field.locator('[style*="font-size"]').count()>0
    field.click()
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
    assert 'Tiptap unified example' in exported
    reopen=context.new_page()
    reopen_errors=[]
    reopen.on('pageerror',lambda error:reopen_errors.append(str(error)))
    reopen.goto(export_file.as_uri(),wait_until='load')
    reopen.wait_for_selector('.el .tiptap-content')
    assert reopen.locator('.el.textbox .tiptap-content').count()==1,reopen_errors
    assert 'Tiptap unified example' in reopen.locator('.el.textbox').inner_text()
    reopen.locator('[data-tab="text"]').click()
    reopen.locator('.el.textbox .tiptap-content').click()
    assert abs(float(reopen.locator('#fontSize').input_value())-20)<.6
    assert not reopen_errors,reopen_errors
    print('PASS '+engine+': exported HTML reopens with full offline text editing')

    assert not errors,errors
    browser.close()
print('All Tiptap end-to-end checks passed for '+engine)
