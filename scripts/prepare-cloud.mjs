import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync('python3', ['build.py'], { stdio: 'inherit' });
await rm('public', { recursive: true, force: true });
await mkdir('public', { recursive: true });
for (const dir of ['css', 'js', 'lib']) await cp(dir, 'public/' + dir, { recursive: true });
let index = '';
for (const name of await readdir('.')) {
  if (name.endsWith('.html')) {
    const html = (await readFile(name, 'utf8')).replace('<head>', '<head>\n<meta name="facility-server" content="same-origin">\n<meta name="facility-cloud" content="upstage">');
    await writeFile('public/' + name, html);
    if (name === 'index.html') index = html;
  } else if (/\.(png|svg)$/.test(name)) await cp(name, 'public/' + name);
}
await mkdir('cloud', { recursive: true });
await writeFile('cloud/static-index.ts', 'export default ' + JSON.stringify(index) + ';\n');
