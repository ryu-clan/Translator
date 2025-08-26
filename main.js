

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

          await msg.reply('ㅤㅤㅤ');

          const end = Date.now();

          msg.reply(`🎃 speed: ${end - start}ms`);

          break;

        }

        case 'alive': {

    // Get username smartly

    const username = msg?.pushName || 

                     msg?.key?.participant?.split('@')[0] || 

                     msg?.key?.remoteJid?.split('@')[0] || 

                     "User";

    // Random parts

    const intros = [

        "Yo", "Hey", "Oi", "Greetings", "What's up", "Holla", "Sup"

    ];

    const cores = [

        "I am alive and running", 

        "I am Alive and active", 

        "Still kicking and coding", 

        "Online and operational", 

        "Ready to roll", 

        "Your bot buddy is here"

    ];

    // Pick random intro + core

    const intro = intros[Math.floor(Math.random() * intros.length)];

    const core = cores[Math.floor(Math.random() * cores.length)];

    // Final reply

    const finalReply = `${intro}, ${username}! ${core}.`;

    await msg.reply(finalReply);

    break;

}

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

`--------[ ♧ Eternity ♧ ]---------

> .ping  ~ Latency Check

> .alive ~ Bot Status

> .tr    ~ Translate Text

> .tre   ~ advance translator 

> .chat  ~ talk with ai 

> .menu  ~ Command List

> .song  ~ Song Downloader

> .Time ~ Time of any country 

> .wame ~ your wame link for whatsapp

 ---------------------------------

  ETERNITY | THE BEST IS YET TO BE 

 ---------------------------------

 `

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

case 'wami': {

    try {

        let userJid;

        // 1. If user tags someone with .wami @user

        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {

            userJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];

        } 

        // 2. If user replies to someone's message with .wami

        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {

            userJid = msg.message.extendedTextMessage.contextInfo.participant;

        } 

        // 3. Default: user's own number

        else {

            userJid = msg.key.participant || msg.key.remoteJid;

        }

        const userNumber = userJid.split('@')[0]; // Extract number

        const waLink = `https://wa.me/${userNumber}`;

        await msg.reply(`*Wa.me Link for ${userNumber}:*\n${waLink}`);

    } catch (e) {

        console.error(e);

        await msg.reply('_Failed to generate link_');

    }

    break;

}
 

function getClosestTimezone(input) {
    const zones = moment.tz.names();
    let closest = null;
    let minDistance = Infinity;

    function levenshtein(a, b) {
        const m = [];
        for (let i = 0; i <= b.length; i++) m[i] = [i];
        for (let j = 0; j <= a.length; j++) m[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                m[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
                    ? m[i - 1][j - 1]
                    : Math.min(m[i - 1][j - 1] + 1, Math.min(m[i][j - 1] + 1, m[i - 1][j] + 1));
            }
        }
        return m[b.length][a.length];
    }

    for (const zone of zones) {
        const dist = levenshtein(input.toLowerCase(), zone.toLowerCase());
        if (dist < minDistance) {
            minDistance = dist;
            closest = zone;
        }
    }
    return closest;
}

case 'time': {
    try {
        if (!args || args.length === 0) {
            return msg.reply("Usage: .time <Continent/City>\nExample: .time Asia/Kolkata");
        }

        const tz = args.join('_');
        if (!moment.tz.zone(tz)) {
            const suggestion = getClosestTimezone(tz);
            return msg.reply(`Invalid timezone!\nDid you mean: *${suggestion}* ?`);
        }

        const time = moment.tz(tz);
        const txt = `*Timezone: ${tz}*\n`
            + `Date: ${time.format('YYYY-MM-DD')}\n`
            + `Time: ${time.format('HH:mm:ss')}\n`
            + `UTC Offset: ${time.format('Z')}`;

        await msg.reply(txt);

    } catch (e) {
        console.error("Time Command Error:", e);
        await msg.reply("_Failed to fetch time info_");
    
}
    break;
}
        
        case 'tre': {
    try {
        if (!args || args.length === 0) {
            return msg.reply("Please provide a text to translate .");
        }

        const prePrompt = "You are a translator. Translate any input text to clear, correct English only. Do not add explanations, comments, or extra messages. ";

        const userQuestion = args.join(' ');

        const res = await fetch("https://garfield-apis.onrender.com/ai/chatgpt_3.5_scr1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: prePrompt },
                    { role: "user", content: userQuestion }
                ]
            })
        });

        const data = await res.json();
        await msg.reply(data.answer || "_No answer received_");

    } catch (e) {
        console.error("idk what is the Error:", e);
        await msg.reply("_Failed to translate text ");
    }
    break;
}
              
              
              case 'chat': {
try {
if (!args || args.length === 0) {
return msg.reply("Please provide a question for Eternity.");
}

const prePrompt = "You are Eternity, an AI assistant. Give short, clear, and useful answers in 2–3 lines. Stay straight to the point, with no extra comments or explanations. you talk in English only ";  

    const userQuestion = args.join(' ');  

    const res = await fetch("https://garfield-apis.onrender.com/ai/chatgpt_3.5_scr1", {  
        method: "POST",  
        headers: { "Content-Type": "application/json" },  
        body: JSON.stringify({  
            messages: [  
                { role: "system", content: prePrompt },  
                { role: "user", content: userQuestion }  
            ]  
        })  
    });  

    const data = await res.json();  
    await msg.reply(data.answer || "_No answer received_");  

} catch (e) {  
    console.error("Eternity Command Error:", e);  
    await msg.reply("_Failed to fetch answer from Eternity");  
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

      console.log('✅️ Phoenix Connected');

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
  

    
  
  
   