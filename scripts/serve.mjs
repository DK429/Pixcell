import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json'};
const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));
    if (!target.startsWith(root) || urlPath.includes('\0')) throw new Error('Invalid path');
    const bytes = await readFile(target);
    res.writeHead(200, {'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(bytes);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Pixcell: http://localhost:${port}`));
