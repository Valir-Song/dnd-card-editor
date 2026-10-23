"""Visual regression: how the sheet LOOKS, not only how it behaves.

The reference is not a committed picture (fonts differ between machines and
would break it) but the editor as it is on `main`: both builds open in the
same browser on the same machine, get the same layouts, and their pages are
compared pixel by pixel. Any difference comes from the code.

An intentional visual change is accepted by listing the new version in
tests/visual-accept.txt: differences are then reported, not failed.
Differing pages are saved to tests/visual-out/ (new, reference, diff).

    python tests/visual_browser_smoke.py
    VISUAL_REFERENCE=path/to/other.html python tests/visual_browser_smoke.py
"""
import base64
import json
import os
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_env import launch, engine

root=Path(__file__).resolve().parents[1]
build=root/'dist'/'index.html'
assert build.exists(), 'Build the standalone HTML before running this test'
out=root/'tests'/'visual-out'
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
accept_file=root/'tests'/'visual-accept.txt'
accepted=accept_file.exists() and version in [line.strip() for line in accept_file.read_text(encoding='utf-8').splitlines() if not line.startswith('#')]

def reference_html():
    """The editor on main (or VISUAL_REFERENCE), as a file next to nothing else."""
    given=os.environ.get('VISUAL_REFERENCE')
    if given: return Path(given)
    def show():
        return subprocess.run(['git','show','origin/main:DND_Card_Editor_standalone.html'],cwd=root,capture_output=True)
    shown=show()
    if shown.returncode:
        subprocess.run(['git','fetch','--quiet','--depth=1','origin','main:refs/remotes/origin/main'],cwd=root)
        shown=show()
    assert not shown.returncode, 'No reference: cannot read DND_Card_Editor_standalone.html from origin/main'
    path=Path(tempfile.mkdtemp(prefix='dnd-visual-'))/'reference.html'
    path.write_bytes(shown.stdout)
    return path

def png(width,height,pixel):
    """A small PNG made here, so both builds get byte-identical pictures."""
    rows=b''.join(b'\x00'+b''.join(bytes(pixel(x,y)) for x in range(width)) for y in range(height))
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(raw).decode()

stripes=png(40,24,lambda x,y:(40+x*5,120,200-y*6) if (x//5+y//5)%2 else (230,210,120))
# Every kind of object, with the options that change how it looks.
FIXTURE=[
  {'id':'h','kind':'header','page':1,'x':10,'y':8,'w':190,'h':26,'z':1,'title':'ПРОВЕРКА ВИДА','subtitle':'Подзаголовок · строка','meta':'КД 15 · HP 39'},
  {'id':'c1','kind':'card','page':1,'x':12,'y':40,'w':91,'h':23,'z':2,'title':'Карточка','meta':'1 круг · 60 фт.','detail':'Описание карточки в две строки, чтобы перенос был виден.','level':'1','bg':'#f4e1f0'},
  {'id':'c2','kind':'card','page':1,'x':107,'y':40,'w':91,'h':23,'z':3,'title':'Сдвинутые тексты','meta':'мета','detail':'Рамка текста растянута вниз и сдвинута.','level':'♪','bg':'#ffffff',
   'textFrames':{'detail':{'x':4,'y':2,'w':60,'h':14}},'badgeX':70,'badgeY':2,'badgeCustomPosition':True},
  {'id':'c3','kind':'card','page':1,'x':12,'y':68,'w':91,'h':30,'z':4,'title':'Фон-картинка','meta':'заполнить','detail':'Текст поверх картинки','level':'3','bg':'#ffffff',
   'bgImage':stripes,'bgFit':'cover','bgOpacity':70,'bgZoom':140,'bgX':10,'bgY':-5,'bgShade':20},
  {'id':'n','kind':'note','page':1,'x':107,'y':68,'w':91,'h':30,'z':5,'title':'ЗАМЕТКА','detail':'Строка один\nСтрока два с переносом'},
  {'id':'r','kind':'resources','page':1,'x':12,'y':102,'w':91,'h':30,'z':6,'title':'РЕСУРСЫ','detail':'Вдохновение: □ □ □\nЯчейки 1: □ □ □ □'},
  {'id':'s','kind':'section','page':1,'x':12,'y':136,'w':186,'h':8,'z':7,'title':'СЕКЦИЯ · ЗАГОЛОВОК'},
  {'id':'rect','kind':'shape','shape':'rect','page':1,'x':107,'y':102,'w':40,'h':20,'z':8,'bg':'#d8c5ed','locked':True},  # a lock never changes the look
  {'id':'circle','kind':'shape','shape':'circle','page':1,'x':152,'y':102,'w':20,'h':20,'z':9,'bg':'#8e6eb0'},
  {'id':'line','kind':'shape','shape':'line','page':1,'x':107,'y':126,'w':90,'h':2,'z':10,'bg':'#745193'},
  {'id':'img','kind':'image','page':1,'x':12,'y':150,'w':50,'h':30,'z':11,'src':stripes,'opacity':80,'brightness':110,'contrast':90,'rotation':0,'fit':'contain'},
  {'id':'tb','kind':'textbox','page':1,'x':70,'y':150,'w':80,'h':25,'z':12,'text':'Текстовое поле с рамкой',
   'fontFamily':'Georgia','fontSize':12,'textAlign':'center','textWeight':'normal','textColor':'#262137','bg':'#fff7e0','borderColor':'#745193','bgTransparent':False,'borderVisible':True,'autoHeight':False},
  {'id':'p2','kind':'card','page':2,'x':20,'y':30,'w':91,'h':23,'z':1,'title':'Вторая страница','meta':'м','detail':'д','level':'2','bg':'#e7f0ff'},
]

def pages(browser,url,layout):
    """PNG data URLs of both pages, rendered with nothing selected or focused."""
    context=browser.new_context(viewport={'width':1400,'height':1000},device_scale_factor=1)
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.goto(url,wait_until='load'); page.wait_for_selector('.el .tiptap-content')
    if layout is not None:
        page.locator('[data-tab="files"]').click()
        page.set_input_files('#import',{'name':'visual.json','mimeType':'application/json','buffer':json.dumps(layout,ensure_ascii=False).encode()})
        page.wait_for_selector(f'.el[data-id="{layout[-1]["id"]}"] .tiptap-content')
    page.mouse.move(1,1)
    # The sticky toolbar would cover the top of the sheet (and carries the version).
    page.add_style_tag(content='.toolbar{display:none!important}')
    page.evaluate("""async()=>{document.activeElement?.blur?.();getSelection()?.removeAllRanges();await document.fonts.ready;
      await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}""")
    shots=['data:image/png;base64,'+base64.b64encode(page.locator(f'#page{n}').screenshot(animations='disabled',caret='hide')).decode() for n in (1,2)]
    assert not errors,errors
    context.close()
    return shots

COMPARE="""async([a,b])=>{
  const load=src=>new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=src});
  const [ia,ib]=await Promise.all([load(a),load(b)]);
  if(ia.width!==ib.width||ia.height!==ib.height)return {size:[ia.width,ia.height,ib.width,ib.height]};
  const draw=img=>{const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return x.getImageData(0,0,c.width,c.height)};
  const da=draw(ia),db=draw(ib),diff=new ImageData(ia.width,ia.height);let count=0;
  for(let i=0;i<da.data.length;i+=4){
    const d=Math.max(Math.abs(da.data[i]-db.data[i]),Math.abs(da.data[i+1]-db.data[i+1]),Math.abs(da.data[i+2]-db.data[i+2]));
    const off=d>24;if(off)count++;
    diff.data[i]=off?255:da.data[i]*0.3+170;diff.data[i+1]=off?0:da.data[i+1]*0.3+170;diff.data[i+2]=off?0:da.data[i+2]*0.3+170;diff.data[i+3]=255;
  }
  const c=document.createElement('canvas');c.width=ia.width;c.height=ia.height;c.getContext('2d').putImageData(diff,0,0);
  return {count,total:ia.width*ia.height,diff:c.toDataURL('image/png')};
}"""
# Anti-aliasing noise from a re-layout of identical content stays far below this.
LIMIT=0.0005

with sync_playwright() as p:
    browser=launch(p)
    reference=reference_html()
    print('NOTE '+engine+': visual reference is '+('VISUAL_REFERENCE' if os.environ.get('VISUAL_REFERENCE') else 'the editor on origin/main'))
    canvas=browser.new_page()
    failures=[]
    for name,layout in [('template',None),('all-kinds',FIXTURE)]:
        new=pages(browser,build.as_uri(),layout)
        old=pages(browser,reference.as_uri(),layout)
        for n,(a,b) in enumerate(zip(new,old),start=1):
            result=canvas.evaluate(COMPARE,[a,b])
            label=f'{name} page {n}'
            if 'size' in result:
                failures.append(f'{label}: size changed {result["size"]}'); continue
            ratio=result['count']/result['total']
            if ratio<=LIMIT:
                print(f'PASS {engine}: {label} looks the same ({result["count"]} px differ)'); continue
            out.mkdir(exist_ok=True)
            stem=f'{engine}-{name}-page{n}'
            for suffix,data in [('new',a),('reference',b),('diff',result['diff'])]:
                (out/f'{stem}-{suffix}.png').write_bytes(base64.b64decode(data.split(',')[1]))
            failures.append(f'{label}: {result["count"]} px differ ({ratio:.3%}), see tests/visual-out/{stem}-diff.png')
    browser.close()

if failures and accepted:
    for line in failures: print(f'NOTE {engine}: accepted visual change ({version}): {line}')
elif failures:
    raise SystemExit('Visual change against main:\n  '+'\n  '.join(failures)+
                     f'\nIf it is intended, add {version} to tests/visual-accept.txt.')
print('Visual checks passed for '+engine)
