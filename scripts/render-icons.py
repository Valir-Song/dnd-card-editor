"""Render the app icons (app/icon*.svg) to the PNG sizes installers want: python scripts/render-icons.py
The PNGs are committed, so this only reruns when an icon changes."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tests'))
from playwright.sync_api import sync_playwright
from browser_env import launch

app=Path(__file__).resolve().parent.parent/'app'
with sync_playwright() as p:
    browser=launch(p)
    for name,sizes in (('icon',(192,512)),('icon-beta',(192,512)),('file-icon',(256,))):
        svg=(app/(name+'.svg')).read_text()
        for size in sizes:
            page=browser.new_page(viewport={'width':size,'height':size})
            page.set_content('<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>'+svg)
            page.screenshot(path=str(app/f'{name}-{size}.png'),omit_background=True)
            page.close()
    browser.close()
print('Icons rendered into app/')
