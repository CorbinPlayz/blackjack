#!/usr/bin/env python3
"""Build a small deploy patch for the Cloudflare MCP/connector 'execute' tool (no CI secrets needed).
usage: node tools/strip-worker.mjs worker/src/index.js /tmp/new.min.js && python3 tools/make-deploy-patch.py <live_deploy.js> /tmp/new.min.js
  live_deploy.js = the comment-stripped, indentation-stripped worker that is live now (the previous run's output).
Writes deploy_new.js (next live copy), hunks.js (paste into execute as `const hunks=[...]`) and prints both sha256 values.
In execute: GET .../workers/scripts/blackjack-table/content/v2 (multipart: take the worker.js part), check sha256 == base,
apply hunks bottom-up with lines.splice(i1, i2-i1, ...text.split('\\n')), check sha256 == new, then PUT multipart (metadata with
main_module worker.js, keep_bindings ['secret_text'], DO bindings ROOM/Room and REGISTRY/Registry, compatibility_date 2024-09-23)."""
import sys, difflib, hashlib
base = open(sys.argv[1]).read()
new = ''.join(l.lstrip(' \t') if l.strip() else l for l in open(sys.argv[2]).read().splitlines(True))
open('deploy_new.js', 'w').write(new)
b, n = base.split('\n'), new.split('\n')
h = [(i1, i2, '\n'.join(n[j1:j2])) for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, b, n, autojunk=False).get_opcodes() if tag != 'equal']
open('hunks.js', 'w').write('const hunks=[\n' + ',\n'.join('[%d,%d,String.raw`%s`]' % x for x in h) + '\n];\n')
print('base sha256', hashlib.sha256(base.encode()).hexdigest()); print('new  sha256', hashlib.sha256(new.encode()).hexdigest()); print(len(h), 'hunks')
