const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');

const PORT = process.env.PORT || 8080;
const PANEL_PASS = process.env.PANEL_PASS || 'admin123';
const USER_UUID = process.env.UUID || 'd342d11e-d424-4583-b36e-524ab1f0afa4';
const WS_PATH = process.env.WS_PATH || '/ws-tunnel';

// دانلود و آماده‌سازی خودکار هسته Xray در صورت نبودن
function setupXray() {
  if (!fs.existsSync('./xray')) {
    console.log('Downloading Xray-core...');
    try {
      execSync('curl -sL -o xray.zip https://github.com || wget -qO xray.zip https://github.com');
      execSync('python3 -c "import zipfile; zipfile.ZipFile(\'xray.zip\').extractall(\'.\')" || unzip -o xray.zip');
      fs.chmodSync('./xray', 0o755);
      fs.unlinkSync('xray.zip');
      console.log('Xray-core ready!');
    } catch (err) {
      console.error('Error setting up Xray:', err.message);
    }
  }
}

setupXray();

// ساخت کانفیگ Xray
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

fs.writeFileSync('./config.json', JSON.stringify(xrayConfig));

// اجرای هسته Xray
if (fs.existsSync('./xray')) {
  spawn('./xray', ['run', '-c', './config.json'], { stdio: 'inherit' });
}

// سرور وب و پنل مدیریتی
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.searchParams.get('pass') !== PANEL_PASS) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <!DOCTYPE html>
      <html dir="rtl" lang="fa">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ورود به پنل</title></head>
      <body style="background:#0f172a;color:#fff;font-family:Tahoma,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
        <div style="background:#1e293b;padding:30px;border-radius:12px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.4);">
          <h2>🔒 پنل اختصاصی VLESS</h2>
          <p style="color:#94a3b8;font-size:14px;">رمز عبور پیش‌فرض: <b>admin123</b></p>
          <form method="GET">
            <input type="password" name="pass" placeholder="رمز عبور..." style="padding:10px;border-radius:6px;border:none;outline:none;margin-bottom:10px;width:200px;"><br>
            <button type="submit" style="padding:10px 20px;border-radius:6px;border:none;background:#3b82f6;color:#fff;cursor:pointer;width:220px;font-weight:bold;">ورود به پنل</button>
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
        .card { background: #1e293b; padding: 25px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 450px; width: 90%; text-align: center; }
        .badge { background: #10b981; color: #064e3b; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
        textarea { width: 100%; height: 85px; background: #0f172a; color: #38bdf8; border: 1px solid #334155; border-radius: 8px; padding: 10px; margin: 15px 0; direction: ltr; font-family: monospace; resize: none; box-sizing: border-box; }
        button { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; width: 100%; font-weight: bold; }
        button:hover { background: #2563eb; }
        .qr { margin-top: 20px; background: white; padding: 10px; border-radius: 8px; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="card">
        <span class="badge">● سرویس فعال است</span>
        <h2>پنل اختصاصی شما</h2>
        <p style="color:#94a3b8;font-size:13px;">لینک زیر را کپی کرده و در برنامه v2rayNG یا Streisand وارد کنید:</p>
        <textarea id="link" readonly>${vlessLink}</textarea>
        <button onclick="copyLink()">کپی کردن لینک اتصال</button>
        <div class="qr">
          <img src="https://qrserver.com{encodeURIComponent(vlessLink)}" alt="QR Code">
        </div>
      </div>
      <script>
        function copyLink() {
          var copyText = document.getElementById("link");
          copyText.select();
          document.execCommand("copy");
          alert("لینک اتصال کپی شد!");
        }
      </script>
    </body>
    </html>
  `);
});

// هدایت ترافیک WebSocket به Xray
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

server.listen(PORT, () => console.log('Server running on port ' + PORT));
