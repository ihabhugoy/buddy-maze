// the list of every game file with its size, for "Save game to this phone" (game/assets-list.json)
import fs from 'fs'; import path from 'path';
const root = process.argv[2], out = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), s = fs.statSync(p); if (f.startsWith('.') || f === 'dbg') continue; if (s.isDirectory()) walk(p); else out.push([path.relative(root, p).split(path.sep).join('/'), s.size]); } };
walk(root);
const keep = out.filter(([f]) => !/\.(md|command)$/.test(f) && f !== 'assets-list.json' && f !== '_headers');
fs.writeFileSync(path.join(root, 'assets-list.json'), JSON.stringify({ files: keep, total: keep.reduce((m, [, s]) => m + s, 0) }));
console.log(keep.length, 'files', (keep.reduce((m, [, s]) => m + s, 0) / 1e6).toFixed(1), 'MB');
