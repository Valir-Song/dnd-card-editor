"""Shared browser launch for the Playwright suites.

EDITOR_BROWSER picks chromium (default) or firefox. CPU_THROTTLE=<rate> slows
every page's CPU that many times in Chromium (DevTools emulation), to expose
timing races before a slow CI runner does.
"""
import os

engine=os.environ.get('EDITOR_BROWSER','chromium')
assert engine in ('chromium','firefox')
throttle=float(os.environ.get('CPU_THROTTLE') or 0)

def launch(p):
    browser=getattr(p,engine).launch(headless=True,args=['--no-sandbox'] if engine=='chromium' else [])
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
