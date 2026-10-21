"""Regression suite for Moveable + Selecto against the actual standalone HTML.
Run independently for Chromium and Firefox via EDITOR_BROWSER.
"""
import json, os, tempfile, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
html=root/'dist'/'index.html'
assert html.exists(), 'Build standalone HTML before running tests'
text=html.read_text(encoding='utf-8')
assert '<script src=' not in text, 'Build must bundle JavaScript'
browser_name=os.environ.get('EDITOR_BROWSER','chromium')
with sync_playwright() as p:
    browser=getattr(p,browser_name).launch(headless=True,args=['--no-sandbox'] if browser_name=='chromium' else [])
    context=browser.new_context(accept_downloads=True)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.on('console',lambda message: print('BROWSER',message.text,flush=True) if 'DND DEBUG' in message.text else None)
    page.goto(html.as_uri(),wait_until='load')
    page.wait_for_selector('.el.card .tiptap-content')
    assert not errors, errors
    assert page.locator('.moveable-control-box').count()>0, 'Moveable not mounted'
    data=[
        dict(id='test-shape',page=1,z=1,kind='shape',shape='rect',x=20,y=35,w=22,h=14,bg='#aabbcc'),
        dict(id='test-image',page=1,z=2,kind='image',src='data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2220%22%20height%3D%2215%22/%3E',x=60,y=35,w=20,h=14),
        dict(id='test-text',page=1,z=3,kind='textbox',x=20,y=70,w=42,h=18,text='Редактируемый текст',fontSize=12),
        dict(id='test-card',page=1,z=4,kind='card',x=95,y=73,w=85,h=23,title='Проверка Tiptap',meta='Заклинание',detail='Проверяем текст',level='1',bg='#ffffff'),
        dict(id='test-page2',page=2,z=1,kind='shape',shape='rect',x=20,y=35,w=22,h=14,bg='#ff0000'),
    ]
    page.set_input_files('#import',{'name':'canvas-test.json','mimeType':'application/json',
                                    'buffer':json.dumps(data,ensure_ascii=False).encode()})
    page.wait_for_selector('[data-id="test-shape"]')
    shape=page.locator('[data-id="test-shape"]')
    img=page.locator('[data-id="test-image"]')
    def layout():
        return page.evaluate('JSON.parse(localStorage.getItem("dnd-card-editor-v3"))')
    def current(id):
        return next(item for item in layout() if item['id']==id)
    def center(locator):
        rect=locator.bounding_box()
        assert rect, 'Object has no bounding rect'
        return (rect['x']+rect['width']/2,rect['y']+rect['height']/2)
    def drag(x,y,dx,dy):
        page.mouse.move(x,y)
        page.mouse.down()
        page.mouse.move(x+dx,y+dy,steps=10)
        page.mouse.up()
    shape.click(position={'x':14,'y':14})
    assert shape.evaluate('e=>e.classList.contains("selected")')
    assert page.locator('.moveable-control-box').count()>0
    img.click(modifiers=['Shift'],position={'x':10,'y':10})
    assert shape.evaluate('e=>e.classList.contains("selected")')
    assert img.evaluate('e=>e.classList.contains("selected")')
    assert page.locator('#selectionCount').inner_text()=='Выбрано: 2'
    print('PASS '+browser_name+': click + Shift+click, multi-target selection')
    before_shape=current('test-shape');before_image=current('test-image')
    x,y=center(shape)
    drag(x,y,38,29)
    after_shape=current('test-shape');after_image=current('test-image')
    assert after_shape['x']>before_shape['x']+2,(before_shape,after_shape,errors)
    assert after_image['x']>before_image['x']+2,(before_image,after_image,errors)
    assert abs((after_shape['x']-before_shape['x'])-(after_image['x']-before_image['x']))<.2
    assert abs((after_shape['y']-before_shape['y'])-(after_image['y']-before_image['y']))<.2
    page.locator('#undo').click()
    assert abs(current('test-shape')['x']-before_shape['x'])<.1
    assert abs(current('test-image')['x']-before_image['x'])<.1
    page.locator('#redo').click()
    assert abs(current('test-shape')['x']-after_shape['x'])<.2
    print('PASS '+browser_name+': Moveable group drag, geometry, one-step undo/redo')
    # Group resize must update both selected objects proportionally. Unlike
    # a saved group, this is a temporary editing selection on one A4 page.
    group_handle=page.locator('.moveable-control-box [data-direction="se"]').last
    assert group_handle.count()==1, 'Moveable group resize handle missing'
    before_group_shape=current('test-shape').copy()
    before_group_image=current('test-image').copy()
    gx,gy=center(group_handle)
    drag(gx,gy,26,17)
    assert current('test-shape')['w']>before_group_shape['w']+1,(current('test-shape'),errors)
    assert current('test-image')['w']>before_group_image['w']+1,(current('test-image'),errors)
    page.locator('#undo').click()
    assert abs(current('test-shape')['w']-before_group_shape['w'])<.1
    assert abs(current('test-image')['w']-before_group_image['w'])<.1
    print('PASS '+browser_name+': Moveable temporary group resize, one-step undo')
    # Explicitly remove the second target, preserving group-drag semantics when
    # clicking a selected member. Then resize a single target.
    img.click(modifiers=['Shift'],position={'x':10,'y':10})
    assert img.evaluate('e=>!e.classList.contains("selected")')
    # Single resize from the bottom right handle: it must update physical mm.
    shape.click(position={'x':12,'y':10})
    handles=page.locator('.moveable-control-box [data-direction="se"]')
    assert handles.count()>0, 'No Moveable southeast handle'
    handle=handles.last
    hx,hy=center(handle)
    original_w=current('test-shape')['w']
    drag(hx,hy,31,22)
    assert current('test-shape')['w']>original_w+2,(original_w,current('test-shape'),errors)
    print('PASS '+browser_name+': Moveable resizing persists object dimensions')
    # Drag a marquee from empty page background around shape and image.
    page_rect=page.locator('#page1').bounding_box()
    scale=page_rect['width']/210
    start_x=page_rect['x']+11*scale
    start_y=page_rect['y']+15*scale
    drag(start_x,start_y,88*scale,52*scale)
    assert shape.evaluate('e=>e.classList.contains("selected")')
    assert img.evaluate('e=>e.classList.contains("selected")')
    assert page.locator('#selectionCount').inner_text()=='Выбрано: 2'
    print('PASS '+browser_name+': Selecto marquee selection on empty page')
    # On a printed sheet no editing affordance may remain visible.
    page.emulate_media(media='print')
    assert page.locator('.moveable-control-box').first.evaluate('e=>getComputedStyle(e).display')=='none'
    page.emulate_media(media='screen')

    # Delete selected group as a single history action, then restore.
    page.keyboard.press('Delete')
    assert page.locator('[data-id="test-shape"]').count()==0
    assert page.locator('[data-id="test-image"]').count()==0
    assert page.locator('[data-id="test-page2"]').count()==1
    page.locator('#undo').click()
    assert page.locator('[data-id="test-shape"]').count()==1
    assert page.locator('[data-id="test-image"]').count()==1
    # Tiptap editing must not trigger Moveable drag or accidental selection.
    field=page.locator('[data-id="test-text"] .tiptap-content')
    previous=current('test-text')
    field.click()
    field.press('End')
    page.keyboard.type(' и ещё текст')
    assert 'ещё текст' in field.inner_text()
    after_text=current('test-text')
    assert after_text['x']==previous['x'] and after_text['y']==previous['y']
    title=page.locator('[data-id="test-card"] .title .tiptap-content')
    title.click()
    title.press('End')
    page.keyboard.type(' + правка')
    assert 'правка' in title.inner_text()
    assert not errors,errors
    print('PASS '+browser_name+': Tiptap focus/edit, geometry retained, multi-delete undo')
    page.locator('[data-tab="files"]').click()
    with page.expect_download() as outcome:
        page.locator('#export').click()
    artifact=outcome.value
    assert '3_3_' in artifact.suggested_filename
    copied=Path(tempfile.mkdtemp(prefix='dnd-33-'))/'exported.html'
    shutil.copy2(Path(artifact.path()),copied)
    reopened=context.new_page()
    reopened_errors=[]
    reopened.on('pageerror',lambda e: reopened_errors.append(str(e)))
    reopened.goto(copied.as_uri(),wait_until='load')
    reopened.wait_for_selector('[data-id="test-shape"]')
    assert reopened.locator('.moveable-control-box').count()>0
    assert 'ещё текст' in reopened.locator('[data-id="test-text"]').inner_text()
    assert not reopened_errors,reopened_errors
    print('PASS '+browser_name+': offline HTML export reopens with both libraries and saved content')
    browser.close()
print('All canvas tests passed: '+browser_name)
