"""Run every browser suite against dist/index.html: python tests/run_e2e.py [chromium|firefox].
Cross-platform replacement for `EDITOR_BROWSER=... python ...`, which Windows shells reject.
"""
import os
import subprocess
import sys
from pathlib import Path

SUITES=['regression_browser_smoke.py','canvas_browser_smoke.py','nested_browser_smoke.py','tiptap_browser_smoke.py']
engine=sys.argv[1] if len(sys.argv)>1 else 'chromium'
here=Path(__file__).resolve().parent
env={**os.environ,'EDITOR_BROWSER':engine}
for suite in SUITES:
    print('==> '+suite+' ('+engine+')',flush=True)
    if subprocess.run([sys.executable,str(here/suite)],env=env).returncode:
        sys.exit('FAILED: '+suite)
print('All browser suites passed for '+engine)
