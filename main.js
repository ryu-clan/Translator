import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeWASocket
} from 'baileys';
import P from 'pino';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import translate from '@vitalets/google-translate-api';
import { Boom } from '@hapi/boom';
import { fileURLToPath } from 'url';
import { SessionCode } from './session.js';
import config from './config.js';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function serialize(sock, m) {
  const type = Object.keys(m.message)[0];
  const body =
    m.message.conversation ||
    m.message[type]?.text ||
    m.message[type]?.caption ||
    '';
  const from = m.key.remoteJid;
  const sender = m.key.participant || from;
  const isGroup = from.endsWith('@g.us');
  return {
    id: m.key.id,
    from,
    sender,
    body,
    isGroup,
    reply: (text) => sock.sendMessage(from, { text }, { quoted: m })
  };
}

async function tr_txt(text, to = 'en') {
  try {
    const res = await axios.get(
      `https://api.naxordeve.qzz.io/tools/translate?text=${encodeURIComponent(text)}&to=${to}`
    );
    if (res.data?.ok) return res.data.result || res.data.text;
  } catch {}
  const result = await translate(text, { to });
  return result.text;
}

async function Phoenix() {
  const sessionDir = path.join(__dirname, 'Session');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
  await SessionCode(config.SESSION_ID, sessionDir);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    version
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.remoteJid === 'status@broadcast') return;

    const msg = serialize(sock, m);

    if (msg.body.startsWith(config.prefix)) {
      const args = msg.body.slice(config.prefix.length).trim().split(' ');
      const cmd = args.shift().toLowerCase();

      switch (cmd) {
        case 'ping': {
          const start = Date.now();
          await msg.reply('Speed...');
          const end = Date.now();
          msg.reply(`🏓 Latency: ${end - start}ms`);
          break;
        }
        case 'alive':
          msg.reply('*I am alive and running*');
          break;
          case 'song': {
    const query = args.join(' ');
  if (!query) return msg.reply(`usage: ${config.prefix}play <song name>`);
  try {const res = await axios.get(`https://api.naxordeve.qzz.io/download/youtube?query=${query}`);
    const data = res.data;
    if (!data || !data.mp3) return msg.reply('_No results found_');
    const caption = `Title: ${data.title}\nQuality: ${data.quality}p`;
    await sock.sendMessage(msg.from, {
      image: { url: data.thumb },
      caption
    }, { quoted: m });
    await sock.sendMessage(msg.from, {
      audio: { url: data.mp3 },
      mimetype: 'audio/mpeg',
      fileName: `${data.title}.mp3`
    }, { quoted: m });

  } catch (e) {
    console.error(e);
    msg.reply('_err_');
  }
  break;
          }
        
          case 'menu':
  msg.reply(
`╭━━━〔 Phoenix Bot 〕
┃  *Prefix:* ${config.prefix}
┃  *Owner:* 'Pheonix'
┃  *Status:* Online
╰━━━━━━━

╭━━━〔 Main〕
┃  ${config.prefix}ping 
┃  ${config.prefix}alive
┃  ${config.prefix}tr  
┃  ${config.prefix}menu
┃  ${config.prefix}song
╰━━━━━━━━`
  );
  break;
        case 'tr': {
          if (!args.length) return msg.reply(`usage: ${config.prefix}tr <text> [lang]`);
          const to = args.length > 1 ? args.pop() : 'en';
          const text = args.join(' ');
          try { const translated = await tr_txt(text, to);
            msg.reply(`*Tr (${to}):*\n${translated}`);
          } catch (e) {
            msg.reply('_failed_');
          }
          break;
        }
      }
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error).output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log('Disconnected, reconnecting in 5s...');
        setTimeout(Phoenix, 5000);
      } else {
        console.log('Logged out, remove auth_info and re-run SessionCode');
      }
    } else if (connection === 'open') {
      console.log('✅ Phoenix Connected');
      try {
        const id = sock.user?.id;
        if (id) await sock.sendMessage(id, { text: '*connected successfully*' });
      } catch (e) {
        console.error(e);
      }
    }
  });

  const PORT = process.env.PORT || 8000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Phoenix Bot is running\n');
  }).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });
}

Phoenix();
