const http = require('http');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');

const PORT = process.env.PORT || 8080;
const PANEL_PASS = process.env.PANEL_PASS || 'admin123';
const USER_UUID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';
const WS_PATH = process.env.WS_PATH || '/ws-tunnel';

let xrayStatus = "در حال بررسی...";
let xrayError = "";

// دانلود و اجرای هسته Xray در پوشه قابل نوشتن /tmp
function setupAndRunXray() {
  const xrayPath = '/tmp/xray';
  const configPath = '/tmp/config.json';

  try {
    if (!fs.existsSync(xrayPath)) {
      console.log('Downloading Xray to /tmp...');
      execSync('curl -sL -o /tmp/xray.zip https://github.com || wget -qO /tmp/xray.zip https://github.com');
      execSync('python3 -c "import zipfile; zipfile.ZipFile(\'/tmp/xray.zip\').extractall(\'/tmp\')" || unzip -o /tmp/xray.zip -d /tmp');
      fs.chmodSync(xrayPath, 0o755);
      if (fs.existsSync('/tmp/xray.zip')) fs.unlinkSync('/tmp/xray.zip');
    }

    const xrayConfig = {
      inbounds: [{
        port: 10000,
        listen: "127.0.0.1",
        protocol: "vless",
        settings: {
          clients: [{ id: USER_UUID }],
          decryption: "none"
        },
        streamSettings: {
          network: "ws",
          wsSettings: { path: WS_PATH }
        }
      }],
      outbounds: [{ protocol: "freedom" }]
    };

    fs.writeFileSync(configPath, JSON.stringify(xrayConfig));
    const child = spawn(xrayPath, ['run', '-c', configPath], { stdio: 'inherit' });
    
    child.on('error', (err) => {
      xrayStatus = "خطا در اجرا";
      xrayError = err.message;
    });

    xrayStatus = "فعال و آماده اتصال ✅";
  } catch (err) {
    xrayStatus = "خطا در دانلود هسته ❌";
    xrayError = err.message;
    console.error(err);
  }
}

setupAndRunXray();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.searchParams.get('pass') !== PANEL_PASS) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <!DOCTYPE html>
      <html dir="rtl" lang="fa">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ورود به پنل</title></head>
      <body style="background:#0f172a;color:#fff;font-family:Tahoma,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
        <div style="background:#1e293b;padding:30px;border-radius:12px;text-align:center;">
          <h2>🔒 پنل اختصاصی VLESS</h2>
          <form method="GET">
            <input type="password" name="pass" placeholder="رمز عبور..." style="padding:10px;border-radius:6px;border:none;outline:none;margin-bottom:10px;width:200px;"><br>
            <button type="submit" style="padding:10px 20px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;width:220px;">ورود</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  const host = req.headers.host;
  const vlessLink = `vless://${USER_UUID}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=${encodeURIComponent(WS_PATH)}#Cloady-VIP`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html dir="rtl" lang="fa">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>پنل مدیریت VLESS</title>
      <style>
        body { background: #0f172a; color: #f8fafc; font-family: Tahoma, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 25px; border-radius: 16px; max-width: 450px; width: 90%; text-align: center; }
        .status { background: #0f172a; padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; border: 1px solid #334155; }
        textarea { width: 100%; height: 85px; background: #0f172a; color: #38bdf8; border: 1px solid #334155; border-radius: 8px; padding: 10px; margin: 10px 0; direction: ltr; font-family: monospace; resize: none; box-sizing: border-box; }
        button { background: #3b82f6; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; width: 100%; font-weight: bold; }
        .qr { margin-top: 15px; background: white; padding: 10px; border-radius: 8px; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="status">وضعیت هسته Xray: <b>${xrayStatus}</b><br><span style="color:#f87171;font-size:11px;">${xrayError}</span></div>
        <textarea id="link" readonly>${vlessLink}</textarea>
        <button onclick="navigator.clipboard.writeText(document.getElementById('link').value);alert('کپی شد!')">کپی کردن لینک اتصال</button>
        <div class="qr"><img src="https://qrserver.com{encodeURIComponent(vlessLink)}"></div>
      </div>
    </body>
    </html>
  `);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith(WS_PATH)) {
    const proxySocket = net.connect(10000, '127.0.0.1', () => {
      proxySocket.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.keys(req.headers).map(k => `${k}: ${req.headers[k]}`).join('\r\n') +
        '\r\n\r\n'
      );
      proxySocket.write(head);
      socket.pipe(proxySocket).pipe(socket);
    });
    proxySocket.on('error', () => socket.end());
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => console.log('Listening on ' + PORT));
