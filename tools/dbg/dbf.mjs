import fs from 'fs'; import { execFileSync } from 'child_process';
const ds = await (await fetch('https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/K7760H')).json();
const f = ds.data.latestVersion.files.find((x) => (x.dataFile.filename || x.label) === 'tx_2020.zip');
console.log('file', f && f.dataFile.id, f && f.dataFile.filesize);
const r = await fetch(`https://dataverse.harvard.edu/api/access/datafile/${f.dataFile.id}`); fs.writeFileSync('/tmp/tx.zip', Buffer.from(await r.arrayBuffer()));
execFileSync('unzip', ['-oq', '/tmp/tx.zip', '-d', '/tmp/tx']); console.log(execFileSync('ls', ['-la', '/tmp/tx']).toString());
const dbf = fs.readdirSync('/tmp/tx').find((x) => x.toLowerCase().endsWith('.dbf')); const b = fs.readFileSync('/tmp/tx/' + dbf);
const n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10); console.log('version', b[0], 'records', n, 'header', hl, 'reclen', rl);
let o = 32, sum = 1; while (b[o] !== 0x0d && o < hl) { const name = b.toString('latin1', o, o + 11).replace(/\0.*$/, ''); const type = String.fromCharCode(b[o + 11]); console.log(name, type, b[o + 16], b[o + 17]); sum += b[o + 16]; o += 32; }
console.log('sum lens', sum);
console.log('row0', JSON.stringify(b.toString('latin1', hl, hl + Math.min(rl, 600))));
