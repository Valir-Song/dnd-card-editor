"""Nested gesture-layer regression tests on the real offline HTML.
Card text frames stay inside their parent item and keep Tiptap editable.
"""
import json,os,shutil,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_env import launch, saved_layout

root=Path(__file__).resolve().parents[1]
html=root/'dist'/'index.html'
assert html.is_file()
engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
data=[
  dict(id='nested-card',kind='card',page=1,z=2,x=24,y=65,w=118,h=72,
       title='Ореол вдохновения',meta='60 фт. · 1 вдохновение',
       detail='До трёх союзников: временные HP и бонус к скорости',
       level='3',bg='#ffffff'),
  dict(id='other-card',kind='card',page=1,z=3,x=24,y=161,w=86,h=36,
       title='Соседняя способность',meta='Касание',detail='Проверка границ',
       level='2',bg='#eeeeee'),
  dict(id='page-two',kind='shape',shape='rect',page=2,z=1,x=25,y=45,w=35,h=25,bg='#123456')
]
with sync_playwright() as p:
  browser=launch(p)
  context=browser.new_context(accept_downloads=True)
  page=context.new_page()
  errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto(html.as_uri(),wait_until='load')
  page.wait_for_selector('.el.card .tiptap-content')
  page.set_input_files('#import',{'name':'nested-test.json','mimeType':'application/json',
        'buffer':json.dumps(data,ensure_ascii=False).encode()})
  card=page.locator('[data-id="nested-card"]')
  title=card.locator('.text-wrap[data-field="title"]')
  meta=card.locator('.text-wrap[data-field="meta"]')
  detail=card.locator('.text-wrap[data-field="detail"]')
  def layout():return saved_layout(page)
  def item(id='nested-card'):return next(o for o in layout() if o['id']==id)
  def center(locator):
    r=locator.bounding_box()
    assert r,r
    return r['x']+r['width']/2,r['y']+r['height']/2
  def drag(x,y,dx,dy):
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+dx,y+dy,steps=12)
    page.mouse.up()
  def handle():
    return page.locator('.gesture-frame.inner:not([hidden]) [data-dir="se"]').last
  def border():
    # The text frame's drag bands sit just outside it, on the gesture layer.
    # Drag only a horizontal band, never a Tiptap glyph.
    lines=page.evaluate("""() => [...document.querySelectorAll('.gesture-frame.inner:not([hidden]) .gesture-edge.top, .gesture-frame.inner:not([hidden]) .gesture-edge.bottom')]
      .map(el => { const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height} })
      .filter(b => b.w>25 && b.h<9).sort((a,b)=>b.w-a.w)""")
    assert lines, 'No drag band on the selected text frame'
    rect=lines[0]
    # The middle of the band is under the N resize handle. Use the
    # first quarter of the band to exercise its draggable segment.
    return rect['x']+rect['w']*.26,rect['y']+rect['h']*.5

  # Selecting a text field must show inner handles WITHOUT moving its card.
  title.locator('.tiptap-content').click()
  assert title.evaluate('el=>el.classList.contains("inner-selected")')
  assert handle().count()==1
  # gesture-layer may retain detached/hidden controls in DOM; check the active child instead.
  assert title.evaluate('el=>el.classList.contains("inner-selected")')
  assert card.locator('.text-grip,.text-resize').count()==0
  assert not item().get('textFrames')
  old=item().copy()
  x,y=border()
  drag(x,y,22,12)
  frame=item().get('textFrames',{}).get('title',{})
  assert frame.get('x',0)>2 and frame.get('y',0)>1,('Drag must persist relative mm offsets',frame,errors)
  assert item()['x']==old['x'] and item()['y']==old['y']
  assert item()['w']==old['w'] and item()['h']==old['h']
  after_move=frame.copy()
  print('PASS '+engine+': drag title by its frame band, parent card stays still')

  # Resize by gesture-layer corner. Existing text and formatting still owned by Tiptap.
  hx,hy=center(handle())
  drag(hx,hy,-30,24)
  resized=item()['textFrames']['title'].copy()
  assert resized['w']>=8 and resized['h']>after_move.get('h',0),('Resize failed',resized,errors)
  page.locator('#undo').click()
  assert item()['textFrames']['title']['x']==after_move['x']
  page.locator('#redo').click()
  assert item()['textFrames']['title']['w']==resized['w']
  print('PASS '+engine+': text-frame resize has one undo/redo checkpoint')

  # Tiptap focuses without accidentally starting a gesture-layer drag.
  title.locator('.tiptap-content').click()
  field=title.locator('.tiptap-content')
  field.press('End')
  page.keyboard.type(' — действует сейчас')
  assert 'действует сейчас' in field.inner_text()
  assert item()['x']==old['x'] and item()['y']==old['y']
  assert item()['textFrames']['title']['x']==after_move['x']
  print('PASS '+engine+': click-to-edit text and the text frame do not interfere')

  # Shift-click selects multiple sibling text frames, but not the whole cards.
  title.locator('.tiptap-content').click()
  meta.locator('.tiptap-content').click(modifiers=['Shift'])
  assert title.evaluate('e=>e.classList.contains("inner-selected")')
  assert meta.evaluate('e=>e.classList.contains("inner-selected")')
  assert page.locator('#selectionCount').inner_text()=='Текстовых блоков: 2'
  assert card.locator('.text-wrap.inner-selected').count()==2
  assert not page.locator('[data-id="other-card"]').evaluate('e=>e.classList.contains("selected")')
  before_title=item()['textFrames']['title'].copy()
  before_meta=item().get('textFrames',{}).get('meta',{}).copy()
  x,y=border()
  drag(x,y,15,13)
  moved=item()['textFrames']
  dx=moved['title']['x']-before_title['x']
  dy=moved['title']['y']-before_title['y']
  assert dx>1 and dy>1, (moved,errors)
  assert abs(dx-(moved['meta']['x']-before_meta.get('x',0)))<.25
  assert abs(dy-(moved['meta']['y']-before_meta.get('y',0)))<.25
  page.locator('#undo').click()
  assert abs(item()['textFrames']['title']['x']-before_title['x'])<.25
  assert abs(item()['textFrames'].get('meta',{}).get('x',0)-before_meta.get('x',0))<.25
  print('PASS '+engine+': group drag of two child frames and one-step undo')
  # Both fields resize together through the gesture layer's GROUP handles, and Undo
  # restores their original dimensions without affecting the enclosing card.
  group_before=item().copy()
  size_before_title=item()['textFrames']['title'].get('w',0)
  size_before_meta=item()['textFrames'].get('meta',{}).get('w',0)
  group_handle=page.locator('.gesture-frame.inner:not([hidden]) [data-dir="se"]').last
  group_handle.wait_for(state='visible')
  ghx,ghy=center(group_handle)
  drag(ghx,ghy,24,13)
  group_after=item()
  assert group_after['textFrames']['title']['w']>size_before_title+1
  assert group_after['textFrames']['meta']['w']>size_before_meta+1
  assert group_after['x']==group_before['x'] and group_after['w']==group_before['w']
  page.locator('#undo').click()
  assert item()['textFrames']['title'].get('w',0)==size_before_title
  assert item()['textFrames'].get('meta',{}).get('w',0)==size_before_meta
  print('PASS '+engine+': grouped inner resize with parent unchanged and one-step undo')

  # Selecting an in-card text field must never let Delete remove the parent.
  page.keyboard.press('Escape')
  page.locator('[data-tab="cards"]').click()
  page.locator('#delete').click()
  assert card.count()==1, 'Inner selection must not delete its parent'
  # Parent gesture-layer takes over when blank area of the card is selected.
  bbox=card.bounding_box()
  page.mouse.click(bbox['x']+bbox['width']-15,bbox['y']+bbox['height']-14)
  assert not title.evaluate('e=>e.classList.contains("inner-selected")')
  assert page.locator('.gesture-frame:not([hidden]) [data-dir="se"]').count()>0
  old_parent=item().copy()
  bbox=card.bounding_box()
  drag(bbox['x']+bbox['width']-30,bbox['y']+bbox['height']-30,28,14)
  assert item()['x']>old_parent['x'] and item()['y']>old_parent['y']
  # Inner frame offsets remain exactly the same after moving the whole card.
  assert item()['textFrames']==old_parent['textFrames']
  print('PASS '+engine+': parent movement keeps nested text offsets unchanged')

  # A fresh click on a child from the moved card re-enters its inner editing mode.
  title.locator('.tiptap-content').click()
  assert title.evaluate('e=>e.classList.contains("inner-selected")')
  try:
    handle().wait_for(state='visible',timeout=2000)
  except Exception:
    print('DIAGNOSTIC reselect',page.evaluate("""() => ({
      nestedSelected: [...document.querySelectorAll('.text-wrap.inner-selected')].map(n=>n.dataset.field),
      innerBoxes: [...document.querySelectorAll('.gesture-frame.inner')].map(n=>({
        display:getComputedStyle(n).display,
        html:n.outerHTML.slice(0,400),
        rect:n.getBoundingClientRect().toJSON()
      })),
      controls:[...document.querySelectorAll('.gesture-frame.inner [data-dir="se"]')].map(n=>({
        display:getComputedStyle(n).display,
        parentDisplay:getComputedStyle(n.closest('.gesture-frame')).display,
        rect:n.getBoundingClientRect().toJSON()
      }))
    })"""))
    raise
  assert card.locator('.tiptap-content').count()==3
  # Alt+marquee inside the blank portion of the parent selects its own child
  # text fields, not text fields of other cards or any page-level shapes.
  box=card.bounding_box()
  page.keyboard.down('Alt')
  drag(box['x']+25,box['y']+90,218,-85)
  page.keyboard.up('Alt')
  assert card.locator('.text-wrap.inner-selected').count()==3
  assert page.locator('[data-id="other-card"] .text-wrap.inner-selected').count()==0
  assert item('other-card').get('textFrames') is None
  print('PASS '+engine+': Alt+marquee selects three sibling fields in one card only')
  page.emulate_media(media='print')
  assert page.locator('.gesture-layer').first.evaluate('e=>getComputedStyle(e).display')=='none'
  page.emulate_media(media='screen')
  assert not errors,errors

  page.locator('[data-tab="files"]').click()
  with page.expect_download() as got:page.locator('#export').click()
  downloaded=Path(got.value.path())
  reopened_path=Path(tempfile.mkdtemp(prefix='dnd-inner-'))/'exported.html'
  shutil.copy2(downloaded,reopened_path)
  reopened=context.new_page()
  reopened_errors=[]
  reopened.on('pageerror',lambda error:reopened_errors.append(str(error)))
  reopened.goto(reopened_path.as_uri(),wait_until='load')
  reopened.wait_for_selector('[data-id="nested-card"] .tiptap-content')
  stored=saved_layout(reopened)
  saved=next(x for x in stored if x['id']=='nested-card')
  assert saved['textFrames']==item()['textFrames']
  assert 'действует сейчас' in reopened.locator('[data-id="nested-card"] .title').inner_text()
  assert not reopened_errors,reopened_errors
  print('PASS '+engine+': HTML export retains ownership, relative offsets and editable text')
  browser.close()
print('Nested text-frame checks passed in '+engine)
