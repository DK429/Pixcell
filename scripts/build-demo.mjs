import {copyFile, mkdir, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, '_site');
const assets = ['index.html', 'styles.css', 'src/app.js', 'src/engine.js', 'src/sharpen.js', 'src/worker.js', 'src/geometry.js', 'src/view.js', 'src/recovery.js'];

await rm(destination, {recursive: true, force: true});
await mkdir(path.join(destination, 'src'), {recursive: true});
for (const asset of assets) {
  await copyFile(path.join(root, asset), path.join(destination, asset));
}
await writeFile(path.join(destination, '.nojekyll'), '');
console.log(`Built Pixcell demo: ${assets.length} application files in _site/`);
