"""CI wrapper: python tests/ci_run.py <suite.py>. Streams the suite's output and, on
failure, repeats its last lines as a GitHub annotation so the cause is visible on
the PR without opening the raw job log.
"""
import subprocess
import sys
from pathlib import Path

suite=Path(__file__).resolve().parent/sys.argv[1]
proc=subprocess.run([sys.executable,str(suite)],capture_output=True,text=True)
output=proc.stdout+proc.stderr
print(output,end='')
if proc.returncode:
    tail='\n'.join(output.strip().splitlines()[-30:])
    tail=tail.replace('%','%25').replace('\r','').replace('\n','%0A')
    print('::error title='+suite.name+' failed::'+tail)
sys.exit(proc.returncode)
