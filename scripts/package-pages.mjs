import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out=path.join(root,'.site');
// The package is generated into its own directory; source files are never removed.
fs.mkdirSync(out,{recursive:true});
for(const name of ['index.html','styleguide.html','src','dist','docs','README.md','METHODOLOGY.md','LICENSE']) {
  fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
}
fs.writeFileSync(path.join(out,'.nojekyll'),'');
console.log('GitHub Pages artifact ready: .site/');
