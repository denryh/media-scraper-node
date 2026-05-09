import http from 'node:http';

const PORT = Number(process.env.PORT) || 8888;
const N_IMG = Number(process.env.N_IMG) || 20;
const N_VID = Number(process.env.N_VID) || 5;

const FILLER = `<p>${'lorem ipsum dolor sit amet '.repeat(40)}</p>`;

function htmlFor(id) {
  const parts = ['<!doctype html><html><body>'];
  for (let i = 0; i < N_IMG; i++) {
    parts.push(FILLER);
    parts.push(`<img src="/static/${id}-img-${i}.jpg" alt="alt-${id}-${i}">`);
  }
  for (let i = 0; i < N_VID; i++) {
    parts.push(FILLER);
    parts.push(`<video src="/static/${id}-vid-${i}.mp4"></video>`);
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

http
  .createServer((req, res) => {
    const id = (req.url ?? '/').split('/').pop() || 'x';
    const body = htmlFor(id);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  })
  .listen(PORT, () => console.log(`mock listening on :${PORT} (img=${N_IMG} vid=${N_VID})`));
