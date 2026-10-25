"""The ready-sheet list (library/index.json) as build-site.mjs writes it, for tests that serve
library/ themselves instead of building the site."""
import json
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]

def library_index():
    script="import {readdirSync,readFileSync} from 'node:fs';import {libraryIndex} from './scripts/library.mjs';"\
      "const {sheets,errors}=libraryIndex(readdirSync('library').map(file=>({file,text:readFileSync('library/'+file,'utf8')})));"\
      "if(errors.length)throw Error(errors.join('\\n'));process.stdout.write(JSON.stringify({sheets}))"
    return json.loads(subprocess.run(['node','--input-type=module','-e',script],cwd=root,check=True,capture_output=True,text=True).stdout)
