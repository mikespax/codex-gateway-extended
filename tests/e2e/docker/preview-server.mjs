import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const server = createServer((request, response) => {
  if (request.url === "/api/message") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ message: "remote-preview-http-ok" }));
    return;
  }
  if (request.url === "/preview-asset.js") {
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.end("document.querySelector('#asset').textContent='remote-preview-static-asset-ok';");
    return;
  }
  if (request.url === "/preview-style.css") {
    response.setHeader("content-type", "text/css; charset=utf-8");
    response.end("#asset { color: rgb(20, 120, 80); }");
    return;
  }
  if (request.url === "/missing-preview-entry.js") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("missing preview entry");
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html><meta charset="utf-8"><title>Remote Preview E2E</title>
    <link rel="stylesheet" href="/preview-style.css">
    <h1>remote-preview-page</h1><p id="asset">loading</p><p id="http">loading</p><p id="ws">loading</p>
    <script src="/preview-asset.js"></script>
    <script src="/missing-preview-entry.js"></script>
    <script>
      fetch('/api/message').then(r=>r.json()).then(({message})=>document.querySelector('#http').textContent=message);
      const socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/browser-preview/websocket?path=/socket');
      socket.addEventListener('open',()=>socket.send('remote-preview-websocket'));
      socket.addEventListener('message',event=>document.querySelector('#ws').textContent=event.data);
      socket.addEventListener('error',()=>document.querySelector('#ws').textContent='websocket-error');
      socket.addEventListener('close',event=>document.querySelector('#ws').textContent='websocket-closed-'+event.code+'-'+event.reason);
    </script>`);
});
const sockets = new WebSocketServer({ noServer: true });
sockets.on("connection", (socket) =>
  socket.on("message", (message, isBinary) => socket.send(message, { binary: isBinary })),
);
server.on("upgrade", (request, socket, head) => {
  sockets.handleUpgrade(request, socket, head, (webSocket) =>
    sockets.emit("connection", webSocket),
  );
});
server.listen(4173, "127.0.0.1");
