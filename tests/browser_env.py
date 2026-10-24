"""Shared browser launch for the Playwright suites.

EDITOR_BROWSER picks chromium (default) or firefox. CPU_THROTTLE=<rate> slows
every page's CPU that many times in Chromium (DevTools emulation), to expose
timing races before a slow CI runner does.
"""
import os

engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
throttle=float(os.environ.get('CPU_THROTTLE') or 0)
PREINSTALLED_CHROMIUM='/opt/pw-browsers/chromium'

def launch(p):
    options={'headless':True,'args':['--no-sandbox'] if engine=='chromium' else []}
    # The cloud image's Chromium can be newer than the build this Playwright expects:
    # then use the preinstalled browser instead of downloading another one.
    if engine=='chromium' and not os.path.exists(p.chromium.executable_path) and os.path.exists(PREINSTALLED_CHROMIUM):
        options['executable_path']=PREINSTALLED_CHROMIUM
    browser=getattr(p,engine).launch(**options)
    if throttle>1 and engine=='chromium':
        new_context=browser.new_context
        def throttled_context(**options):
            context=new_context(**options)
            new_page=context.new_page
            def throttled_page():
                page=new_page()
                context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate',{'rate':throttle})
                return page
            context.new_page=throttled_page
            return context
        browser.new_context=throttled_context
    return browser

# Saved layouts live in IndexedDB, or in localStorage when the browser refuses
# a database (html[data-storage] says which). Autosave runs in the background,
# so these helpers first wait until no write is in flight.
_STORAGE_JS = """
const idle=()=>new Promise(r=>{const check=()=>document.documentElement.dataset.saveState==='saving'?setTimeout(check,20):r();check()});
const db=()=>new Promise((r,j)=>{const o=indexedDB.open('dnd-card-editor');o.onsuccess=()=>r(o.result);o.onerror=()=>j(o.error)});
const tx=(stores,mode,fn)=>db().then(d=>new Promise((r,j)=>{const t=d.transaction(stores,mode);const out=fn(t);t.oncomplete=()=>r(out&&out.result);t.onerror=()=>j(t.error)}));
const local=()=>document.documentElement.dataset.storage==='localstorage';
"""

def saved_record(page,layout_id=None):
    """The saved record {id,name,savedAt,items} of a layout (default: the open one), or None."""
    return page.evaluate("async id=>{"+_STORAGE_JS+"""await idle();id=id||document.documentElement.dataset.layoutId;
      if(local()){const raw=localStorage.getItem('dnd-card-editor-layout:'+id);return raw===null?null:JSON.parse(raw)}
      return (await tx('layouts','readonly',t=>t.objectStore('layouts').get(id)))??null}""",layout_id)

def saved_layout(page,layout_id=None):
    record=saved_record(page,layout_id)
    return record and record['items']

def put_saved(page,record):
    """Write a record directly, as a browser holding an older save would have it."""
    page.evaluate("async r=>{"+_STORAGE_JS+"""await idle();
      if(local()){localStorage.setItem('dnd-card-editor-layout:'+r.id,typeof r.items==='string'?r.items:JSON.stringify(r));
        const index=JSON.parse(localStorage.getItem('dnd-card-editor-layouts')||'[]').filter(m=>m.id!==r.id);
        localStorage.setItem('dnd-card-editor-layouts',JSON.stringify([...index,{id:r.id,name:r.name,savedAt:r.savedAt,count:0,bytes:0}]));return}
      await tx(['layouts','meta'],'readwrite',t=>{t.objectStore('layouts').put(r);t.objectStore('meta').put({id:r.id,name:r.name,savedAt:r.savedAt,count:0,bytes:0})})}""",record)

def remove_saved(page,layout_id=None):
    page.evaluate("async id=>{"+_STORAGE_JS+"""await idle();id=id||document.documentElement.dataset.layoutId;
      if(local()){localStorage.removeItem('dnd-card-editor-layout:'+id);return}
      await tx(['layouts','meta'],'readwrite',t=>{t.objectStore('layouts').delete(id);t.objectStore('meta').delete(id)})}""",layout_id)
