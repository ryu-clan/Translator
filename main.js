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
import moment from 'moment-timezone';
import fetch from 'node-fetch';
import { Command } from './commands/index.js';

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
      `https://api.naxordeve.qzz.io/tools/translate?text=${text}&to=${to}`
    );
    if (res.data?.ok) return res.data.result || res.data.text;
  } catch {}
  const result = await translate(text, { to });
  return result.text;
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

async function Phoenix() {
  const sessionDir = path.join(__dirname, 'Session');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
  await SessionCode(config.SESSION_ID, sessionDir);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();
  const game = new Map();
  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    version
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.remoteJid === 'status@broadcast') return;
    const msg = serialize(sock, m);            
try {
    const chatId = (typeof m !== 'undefined' && (m.chat || m.from)) || (typeof msg !== 'undefined' && (msg.chat || msg.from)) || '';
    const senderId = (typeof m !== 'undefined' && (m.sender || m.from)) || (typeof msg !== 'undefined' && (msg.sender || msg.from)) || '';
    const text = String((m && (m.text || m.body || (m.message && (m.message.conversation || m.message.extendedTextMessage?.text)))) || (msg && (msg.text || msg.body)) || '').trim();
    if (!chatId || !text)
    } else if (global.tttGames && global.tttGames.has(chatId)) {
        const session = global.tttGames.get(chatId);
        const game = session.game;
        function send(textToSend) {
            if (m && typeof m.reply === 'function') return m.reply(textToSend);
            if (typeof reply === 'function') return reply(textToSend);
            if (msg && typeof msg.reply === 'function') return msg.reply(textToSend);
            console.log('[TTT] ' + textToSend);
        }

        
        if (!session.botMode && session.waitingJoin && text.toLowerCase() === 'join') {
            if (senderId === session.challenger) return send('You started the challenge - waiting for the other player to join.');
            game.playerO = senderId;
            session.waitingJoin = false;
            
            global.tttGames.set(chatId, session);
            return send(`Game started!\n\n${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? '❌ (X) — challenger' : '⭕ (O) — opponent' }\nReply with 1-9 to play.`);
        }
        const n = parseInt(text);
        if (!isNaN(n) && n >= 1 && n <= 9) {
            const pos = n - 1;
            if (!session.botMode && session.waitingJoin) return; 
            const expectedPlayer = game.currentPlayerId;
            if (expectedPlayer !== 'BOT' && senderId !== expectedPlayer) {
                return; 
            }

            const res = game.play(pos);
            if (res === -1) return send('Invalid move or game already ended.');
            if (res === 0) return send('That position is already taken. Pick another one.');
            const winnerIdAfterPlayer = game.winner();
            if (winnerIdAfterPlayer) {
                global.tttGames.delete(chatId);
                const who = (winnerIdAfterPlayer === 'BOT') ? 'BOT' : (winnerIdAfterPlayer === game.playerX ? '❌ (X)' : '⭕ (O)');
                return send(`${game.renderBoard()}\n\n🏆 Winner: ${who}`);
            }
            if (game.isFull()) {
                global.tttGames.delete(chatId);
                return send(`${game.renderBoard()}\n\nIt's a draw!`);
            }

            if (session.botMode && game.currentPlayerId === 'BOT') {
                const moves = game.availableMoves();
              const wouldWin = (testPos, forO) => {
                    const tx = game._x;
                    const to = game._o;
                    if (forO) {
                        const newO = to | (1 << testPos);
                        for (let p of game.patterns) if ((newO & p) === p) return true;
                        return false;
                    } else {
                        const newX = tx | (1 << testPos);
                        for (let p of game.patterns) if ((newX & p) === p) return true;
                        return false;
                    }
                };
                let botMove = moves.find(mv => wouldWin(mv, true));
                if (botMove === undefined) botMove = moves.find(mv => wouldWin(mv, false));
                if (botMove === undefined && moves.includes(4)) botMove = 4;
                if (botMove === undefined) botMove = moves[Math.floor(Math.random() * moves.length)];
                game.play(botMove);
                const winnerAfterBot = game.winner();
                if (winnerAfterBot) {
                    global.tttGames.delete(chatId);
                    const who = (winnerAfterBot === 'BOT') ? 'BOT' : (winnerAfterBot === game.playerX ? '❌ (X)' : '⭕ (O)');
                    return send(`${game.renderBoard()}\n\n🏆 Winner: ${who}`);
                }
                if (game.isFull()) {
                    global.tttGames.delete(chatId);
                    return send(`${game.renderBoard()}\n\nIt's a draw!`);
                }

                
                return send(`${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? '❌ (X)' : (game.currentPlayerId === 'BOT' ? 'BOT' : '⭕ (O)') }`);
            }

            if (!session.botMode) {
                const winnerNow = game.winner();
                if (winnerNow) {
                    global.tttGames.delete(chatId);
                    const who = (winnerNow === game.playerX) ? '❌ (X) — challenger' : '⭕ (O) — opponent';
                    return send(`${game.renderBoard()}\n\n🏆 Winner: ${who}`);
                }
                if (game.isFull()) {
                    global.tttGames.delete(chatId);
                    return send(`${game.renderBoard()}\n\nIt's a draw!`);
                }
                return send(`${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? '❌ (X) — challenger' : '⭕ (O) — opponent'}`);
            }
        } 
    }
} catch (e) {
    console.error(e);
}      
    if (game.has(msg.from)) {
      try {
        const session = game.get(msg.from);
        if (msg.sender !== session.starter) {
          console.log('Ignoring answer from non-starter');
          return; 
        }
        
        const body = msg.body.trim();
        const options = session.current.options;
        const correct = session.current.answer;
        console.log('Received answer:', body);
        console.log('Correct answer:', correct);
        console.log('Options:', options);
        let isCorrect = false;
        if (/^[1-4]$/.test(body)) {
          const index = parseInt(body) - 1;
          if (index >= 0 && index < options.length && 
              options[index].toLowerCase() === correct.toLowerCase()) {
            isCorrect = true;
          }
        } else if (body.toLowerCase() === correct.toLowerCase()) {
          isCorrect = true;
        }

        console.log('Answer correct:', isCorrect);

        let feedback;
        if (isCorrect) {
          session.score++;
          feedback = '✅ *Correct*';
        } else {
          session.lives--;
          feedback = `❌ *Wrong*\n✅ *Answer:* ${correct}`;
        }
        if (session.lives === 0 || session.total + 1 >= session.max) {
          game.delete(msg.from);
          console.log('Game ended in group:', msg.from);
          await msg.reply(`👻 *Game Over*\n\n🎖 *Final Score:* ${session.score} / ${session.total + 1}`);
          return; 
        }

        session.total++;
        session.current = session.questions[session.total];
        const nextOptions = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        const q = `${feedback}\n\n🧠 *Question:*\n${session.current.question}\n\n🎯 *Options:*\n${nextOptions}\n\n❤️ *Lives:* ${session.lives}\n🏅 *Score:* ${session.score}\n📋 *Question:* ${session.total + 1}/${session.max}\n\n*💬 Reply with the correct number (1-4) or type the answer*`;
        await msg.reply(q);
        return; 
        
      } catch (error) {
        console.error(error);
        game.delete(msg.from); 
        await msg.reply('An error occurred in the quiz. The game has been reset');
      }
    }

    if (msg.body.startsWith(config.prefix)) {    
      const args = msg.body.slice(config.prefix.length).trim().split(' ');    
      const cmd = args.shift().toLowerCase();    
      const context = {
        sock,
        m,
        config,
        tr_txt,
        getClosestTimezone,
        axios,
        fetch,
        moment
      };

      const handled = await Command(cmd, msg, args, context);
      if (!handled) {
        switch (cmd) {          
          default:
            msg.reply(`unkown: ${cmd}. use ${config.prefix}menu cmds`);
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
