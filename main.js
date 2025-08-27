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

      
      
      
      // ====== TTT REPLY/PLAY HANDLER (paste after switch-case so it runs on every incoming message) ======
try {
    const chatId = (typeof m !== 'undefined' && (m.chat || m.from)) || (typeof msg !== 'undefined' && (msg.chat || msg.from)) || '';
    const senderId = (typeof m !== 'undefined' && (m.sender || m.from)) || (typeof msg !== 'undefined' && (msg.sender || msg.from)) || '';
    const text = String((m && (m.text || m.body || (m.message && (m.message.conversation || m.message.extendedTextMessage?.text)))) || (msg && (msg.text || msg.body)) || '').trim();

    if (!chatId || !text) {
        // nothing to do
    } else if (global.tttGames && global.tttGames.has(chatId)) {
        const session = global.tttGames.get(chatId);
        const game = session.game;

        // helper send
        function send(textToSend) {
            if (m && typeof m.reply === 'function') return m.reply(textToSend);
            if (typeof reply === 'function') return reply(textToSend);
            if (msg && typeof msg.reply === 'function') return msg.reply(textToSend);
            console.log('[TTT] ' + textToSend);
        }

        // Player vs Player: accept join
        if (!session.botMode && session.waitingJoin && text.toLowerCase() === 'join') {
            if (senderId === session.challenger) return send('You started the challenge - waiting for the other player to join.');
            game.playerO = senderId;
            session.waitingJoin = false;
            // store updated session
            global.tttGames.set(chatId, session);
            return send(`Game started!\n\n${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? 'âŒ (X) â€” challenger' : 'â­• (O) â€” opponent' }\nReply with 1-9 to play.`);
        }

        // Accept numeric moves 1-9
        const n = parseInt(text);
        if (!isNaN(n) && n >= 1 && n <= 9) {
            const pos = n - 1;

            // If waiting for join, reject
            if (!session.botMode && session.waitingJoin) return; // ignore until someone joins

            // Check whose turn it is
            const expectedPlayer = game.currentPlayerId;

            // In bot mode expectedPlayer for bot is 'BOT'
            if (expectedPlayer !== 'BOT' && senderId !== expectedPlayer) {
                return; // ignore messages from spectators or other commands (silent ignore)
            }

            // play the move
            const res = game.play(pos);
            if (res === -1) return send('Invalid move or game already ended.');
            if (res === 0) return send('That position is already taken. Pick another one.');

            // After player move, check winner/draw
            const winnerIdAfterPlayer = game.winner();
            if (winnerIdAfterPlayer) {
                global.tttGames.delete(chatId);
                const who = (winnerIdAfterPlayer === 'BOT') ? 'BOT' : (winnerIdAfterPlayer === game.playerX ? 'âŒ (X)' : 'â­• (O)');
                return send(`${game.renderBoard()}\n\nðŸ† Winner: ${who}`);
            }
            if (game.isFull()) {
                global.tttGames.delete(chatId);
                return send(`${game.renderBoard()}\n\nIt's a draw!`);
            }

            // If bot mode and it's bot's turn -> perform bot move
            if (session.botMode && game.currentPlayerId === 'BOT') {
                // pick a smart/random move: first try win, then block, then random
                const moves = game.availableMoves();

                // helper to test if a move would make given side win
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

                // 1) winning move for BOT (O)
                let botMove = moves.find(mv => wouldWin(mv, true));
                // 2) block player X
                if (botMove === undefined) botMove = moves.find(mv => wouldWin(mv, false));
                // 3) center
                if (botMove === undefined && moves.includes(4)) botMove = 4;
                // 4) random
                if (botMove === undefined) botMove = moves[Math.floor(Math.random() * moves.length)];

                // bot plays
                game.play(botMove);

                // check result after bot move
                const winnerAfterBot = game.winner();
                if (winnerAfterBot) {
                    global.tttGames.delete(chatId);
                    const who = (winnerAfterBot === 'BOT') ? 'BOT' : (winnerAfterBot === game.playerX ? 'âŒ (X)' : 'â­• (O)');
                    return send(`${game.renderBoard()}\n\nðŸ† Winner: ${who}`);
                }
                if (game.isFull()) {
                    global.tttGames.delete(chatId);
                    return send(`${game.renderBoard()}\n\nIt's a draw!`);
                }

                // else game continues
                return send(`${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? 'âŒ (X)' : (game.currentPlayerId === 'BOT' ? 'BOT' : 'â­• (O)') }`);
            }

            // Not bot mode (PvP) and move made -> check further
            if (!session.botMode) {
                const winnerNow = game.winner();
                if (winnerNow) {
                    global.tttGames.delete(chatId);
                    const who = (winnerNow === game.playerX) ? 'âŒ (X) â€” challenger' : 'â­• (O) â€” opponent';
                    return send(`${game.renderBoard()}\n\nðŸ† Winner: ${who}`);
                }
                if (game.isFull()) {
                    global.tttGames.delete(chatId);
                    return send(`${game.renderBoard()}\n\nIt's a draw!`);
                }
                // else continue
                return send(`${game.renderBoard()}\n\nTurn: ${game.currentPlayerId === game.playerX ? 'âŒ (X) â€” challenger' : 'â­• (O) â€” opponent'}`);
            }
        } // end numeric move handling
    }
} catch (e) {
    console.error('TTT handler error', e);
}
      
   
      
      
      // Check if this is a quiz answer (BEFORE processing commands)
    if (game.has(msg.from)) {
      try {
        const session = game.get(msg.from);
        console.log('Processing answer from:', msg.sender, 'for session:', session.starter);
        
        // Only the quiz starter should answer in this implementation
        if (msg.sender !== session.starter) {
          console.log('Ignoring answer from non-starter');
          return; // Don't process this as a command
        }
        
        const body = msg.body.trim();
        const options = session.current.options;
        const correct = session.current.answer;

        console.log('Received answer:', body);
        console.log('Correct answer:', correct);
        console.log('Options:', options);

        // Check number or text, case-insensitive
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
          feedback = 'âœ… *Correct*';
        } else {
          session.lives--;
          feedback = `âŒ *Wrong*\nâœ… *Answer:* ${correct}`;
        }

        // Check if game should end
        if (session.lives === 0 || session.total + 1 >= session.max) {
          game.delete(msg.from);
          console.log('Game ended in group:', msg.from);
          await msg.reply(`ðŸ‘» *Game Over*\n\nðŸŽ– *Final Score:* ${session.score} / ${session.total + 1}`);
          return; // End here if game is over
        }

        // Move to next question
        session.total++;
        session.current = session.questions[session.total];

        const nextOptions = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        const q = `${feedback}\n\nðŸ§  *Question:*\n${session.current.question}\n\nðŸŽ¯ *Options:*\n${nextOptions}\n\nâ¤ï¸ *Lives:* ${session.lives}\nðŸ… *Score:* ${session.score}\nðŸ“‹ *Question:* ${session.total + 1}/${session.max}\n\n*ðŸ’¬ Reply with the correct number (1-4) or type the answer*`;

        await msg.reply(q);
        return; // Return after processing quiz answer
        
      } catch (error) {
        console.error('Quiz answer processing error:', error);
        game.delete(msg.from); // Clear the session on error
        await msg.reply('âŒ An error occurred in the quiz. The game has been reset.');
      }
    }

    // Only process commands if message starts with prefix
    if (msg.body.startsWith(config.prefix)) {    
      const args = msg.body.slice(config.prefix.length).trim().split(' ');    
      const cmd = args.shift().toLowerCase();    
      
      switch (cmd) {    
        case 'ping': {    
          const start = Date.now();    
          await msg.reply(` ã…¤ã…¤ã…¤`);    
          const end = Date.now();    
          msg.reply(` ðŸŽƒ speed: ${end - start}ms`);    
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
          
        case 'song': {    
          const query = args.join(' ');  
          if (!query) return msg.reply(`usage: ${config.prefix}song <song name>`);  
          try {  
            const res = await axios.get(`https://api.naxordeve.qzz.io/download/youtube?query=${query}`);  
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
          
        case 'menu': {
          // Check if user wants the fun menu
          if (args.includes('--fun')) {
            msg.reply(`--------[ â™§ Eternity Fun Section â™§ ]---------
> .tr    ~ Translate Text
> .chat  ~ Talk with AI
> .song  ~ Song Downloader
> .time  ~ Time of any country
> .wame  ~ Your WhatsApp link
> .carbon ~ Create code images
> .removebg ~ Remove image background
> .animequiz ~ Anime trivia game
------------------------------------
ETERNITY | THE BEST IS YET TO BE
------------------------------------`);
          } else {
            // Show the main menu
            msg.reply(`--------[ â™§ Eternity â™§ ]---------
> .ping  ~ Latency Check
> .alive ~ Bot Status
> .menu --fun ~ Fun Commands
> .define ~ Urban Dictionary lookup
> .weather ~ Weather information
------------------------------------
ETERNITY | THE BEST IS YET TO BE
------------------------------------`);
          }
          break;
        }

        case 'tr': {    
          if (!args.length) return msg.reply(`usage: ${config.prefix}tr <text> [lang]`);    
          const to = args.length > 1 ? args.pop() : 'en';    
          const text = args.join(' ');    
          try {   
            const translated = await tr_txt(text, to);    
            msg.reply(`*Tr (${to}):*\n${translated}`);    
          } catch (e) {    
            msg.reply('_failed_');    
          }    
          break;    
        }  
          
        case 'wame': {
          try {
            let userJid;

            // 1. If user mentions someone with @  
            if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {  
              userJid = m.message.extendedTextMessage.contextInfo.mentionedJid[0];  
            }   
            // 2. If user replies to someone's message  
            else if (m.message?.extendedTextMessage?.contextInfo?.participant) {  
              userJid = m.message.extendedTextMessage.contextInfo.participant;  
            }   
            // 3. If user provides a number as argument  
            else if (args.length > 0) {  
              let num = args[0];  
              // Clean the number (remove non-digit characters)  
              num = num.replace(/[^0-9]/g, '');  
              // Remove leading zeros and ensure proper format  
              if (num.startsWith('0')) {  
                num = num.substring(1);  
              }  
              userJid = num + '@s.whatsapp.net';  
            }  
            // 4. Default: user's own number  
            else {  
              userJid = m.key.participant || m.key.remoteJid;  
            }  
            
            // Extract just the number part  
            const userNumber = userJid.split('@')[0];  
            const waLink = `https://wa.me/${userNumber}`;  
            
            await sock.sendMessage(msg.from, {  
              text: `*WhatsApp Link for ${userNumber}:*\n${waLink}`,  
              mentions: [userJid]  
            }, { quoted: m });

          } catch (e) {
            console.error('Wame Command Error:', e);
            await msg.reply('Failed to generate WhatsApp link');
          }
          break;
        }
        
        case 'status': {
          try {
            let userJid;

            // Determine which user to get status for  
            if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {  
              userJid = m.message.extendedTextMessage.contextInfo.mentionedJid[0];  
            } else if (m.message?.extendedTextMessage?.contextInfo?.participant) {  
              userJid = m.message.extendedTextMessage.contextInfo.participant;  
            } else if (args.length > 0) {  
              // Try to extract number from arguments  
              let num = args[0].replace(/[^0-9]/g, '');  
              if (num.startsWith('0')) {  
                num = num.substring(1);  
              }  
              userJid = num + '@s.whatsapp.net';  
            } else {  
              userJid = m.key.participant || m.key.remoteJid;  
            }  
            
            // Fetch user's status  
            const status = await sock.fetchStatus(userJid).catch(() => null);  
            
            if (!status || !status.status) {  
              return await sock.sendMessage(msg.from, {  
                text: '_No status set for this user_'  
              }, { quoted: m });  
            }  
            
            // Try to get profile picture  
            let pfp = null;  
            try {  
              pfp = await sock.profilePictureUrl(userJid, 'image');  
            } catch (error) {  
              console.log('No profile picture available');  
            }  
            
            const time = new Date(status.setAt).toLocaleString('en-US', {  
              timeZone: 'UTC',  
              year: 'numeric',  
              month: 'short',  
              day: 'numeric',  
              hour: '2-digit',  
              minute: '2-digit'  
            });  
            
            const text = `*Status of* @${userJid.split('@')[0]}:\n\n${status.status}\n\nSet at: ${time}`;  
            
            if (pfp) {  
              await sock.sendMessage(msg.from, {  
                image: { url: pfp },  
                caption: text,  
                mentions: [userJid]  
              }, { quoted: m });  
            } else {  
              await sock.sendMessage(msg.from, {  
                text: text,  
                mentions: [userJid]  
              }, { quoted: m });  
            }

          } catch (e) {
            console.error('Status Command Error:', e);
            await sock.sendMessage(msg.from, {
              text: 'Failed to fetch status. Make sure the user exists and you have permission.'
            }, { quoted: m });
          }
          break;
        }

        case 'define': {
          try {
            if (!args.length) return await msg.reply(`Usage: ${config.prefix}define <word>`);

            const word = args.join(' ');  
            const response = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(word)}`);  
            const data = await response.json();  

            if (!data.list?.length) return await msg.reply(`_No definition found for "${word}"_`);  

            const entry = data.list[0];  
            const definition = entry.definition.replace(/î€|î€/g, '');  
            const example = entry.example?.replace(/î€|î€/g, '') || 'No example';  

            const text = `${word} - eternity Dictionary

ðŸ”–â€“ Definition:
${definition}

ðŸŽƒÂ¡ Example:
${example}`;

            await msg.reply(text);

          } catch (error) {
            console.error('Define Error:', error);
            await msg.reply('Failed to fetch definition');
          }
          break;
        }

        case 'time': {  
          try {  
            if (!args || args.length === 0) {  
              return msg.reply("Usage: .time <Continent/City>\nExample: .time Asia/Kolkata");  
            }  

            // Join with spaces first, then replace spaces with underscores  
            let tzInput = args.join(' ');  
              
            // If user typed something like "Asia Kolkata", convert to "Asia/Kolkata"  
            if (tzInput.includes(' ')) {  
              tzInput = tzInput.replace(' ', '/');  
            }  
              
            // Check if it's a valid timezone  
            if (!moment.tz.zone(tzInput)) {  
              // If not valid, try common alternatives  
              let suggestedTz = null;  
                
              // Common timezone mappings  
              const commonTimezones = {  
                // India region  
                'india': 'Asia/Kolkata',  
                'kolkata': 'Asia/Kolkata',  
                'mumbai': 'Asia/Kolkata',  
                'delhi': 'Asia/Kolkata',  
                'chennai': 'Asia/Kolkata',  
                'bangalore': 'Asia/Kolkata',  
                'hyderabad': 'Asia/Kolkata',  
                'pune': 'Asia/Kolkata',  
                'ahmedabad': 'Asia/Kolkata',  
                'jaipur': 'Asia/Kolkata',  
                'lucknow': 'Asia/Kolkata',  
                'kanpur': 'Asia/Kolkata',  
                'nagpur': 'Asia/Kolkata',  
                'indore': 'Asia/Kolkata',  
                'thane': 'Asia/Kolkata',  
                'bhopal': 'Asia/Kolkata',  
                'visakhapatnam': 'Asia/Kolkata',  
                'patna': 'Asia/Kolkata',  
                'vadodara': 'Asia/Kolkata',  
                'ghaziabad': 'Asia/Kolkata',  
                'ludhiana': 'Asia/Kolkata',  
                'agra': 'Asia/Kolkata',  
                'nashik': 'Asia/Kolkata',  
                'faridabad': 'Asia/Kolkata',  
                'meerut': 'Asia/Kolkata',  
                'rajkot': 'Asia/Kolkata',  
                'kalyan': 'Asia/Kolkata',  
                'varanasi': 'Asia/Kolkata',  
                'srinagar': 'Asia/Kolkata',  
                'amritsar': 'Asia/Kolkata',  
                'navimumbai': 'Asia/Kolkata',  
                'ranchi': 'Asia/Kolkata',  
                'kochi': 'Asia/Kolkata',  
                'guwahati': 'Asia/Kolkata',  
                'chandigarh': 'Asia/Kolkata',  
                'thiruvananthapuram': 'Asia/Kolkata',  
                'coimbatore': 'Asia/Kolkata',  
                'jodhpur': 'Asia/Kolkata',  
                'madurai': 'Asia/Kolkata',  
                'salem': 'Asia/Kolkata',  
                'tiruchirappalli': 'Asia/Kolkata',  
                'kota': 'Asia/Kolkata',  
                'bhubaneswar': 'Asia/Kolkata',  
                'aligarh': 'Asia/Kolkata',  
                'bareilly': 'Asia/Kolkata',  
                'moradabad': 'Asia/Kolkata',  
                'mysore': 'Asia/Kolkata',  
                'gurgaon': 'Asia/Kolkata',  
                'noida': 'Asia/Kolkata',  
                'shimla': 'Asia/Kolkata',  
                'dehradun': 'Asia/Kolkata',  
                  
                // USA region  
                'usa': 'America/New_York',  
                'newyork': 'America/New_York',  
                'ny': 'America/New_York',  
                'nyc': 'America/New_York',  
                'losangeles': 'America/Los_Angeles',  
                'la': 'America/Los_Angeles',  
                'chicago': 'America/Chicago',  
                'houston': 'America/Chicago',  
                'phoenix': 'America/Phoenix',  
                'philadelphia': 'America/New_York',  
                'sanantonio': 'America/Chicago',  
                'sandiego': 'America/Los_Angeles',  
                'dallas': 'America/Chicago',  
                'sanfrancisco': 'America/Los_Angeles',  
                'sf': 'America/Los_Angeles',  
                'austin': 'America/Chicago',  
                'jacksonville': 'America/New_York',  
                'fortworth': 'America/Chicago',  
                'columbus': 'America/New_York',  
                'charlotte': 'America/New_York',  
                'indianapolis': 'America/New_York',  
                'seattle': 'America/Los_Angeles',  
                'denver': 'America/Denver',  
                'washington': 'America/New_York',  
                'dc': 'America/New_York',  
                'boston': 'America/New_York',  
                'elpaso': 'America/Denver',  
                'detroit': 'America/New_York',  
                'nashville': 'America/Chicago',  
                'memphis': 'America/Chicago',  
                'portland': 'America/Los_Angeles',  
                'lasvegas': 'America/Los_Angeles',  
                'lv': 'America/Los_Angeles',  
                'baltimore': 'America/New_York',  
                'milwaukee': 'America/Chicago',  
                'albuquerque': 'America/Denver',  
                'tucson': 'America/Phoenix',  
                'fresno': 'America/Los_Angeles',  
                'sacramento': 'America/Los_Angeles',  
                'kansascity': 'America/Chicago',  
                'atlanta': 'America/New_York',  
                'miami': 'America/New_York',  
                'orlando': 'America/New_York',  
                'tampa': 'America/New_York',  
                'cleveland': 'America/New_York',  
                'pittsburgh': 'America/New_York',  
                'cincinnati': 'America/New_York',  
                'minneapolis': 'America/Chicago',  
                'oklahomacity': 'America/Chicago',  
                'neworleans': 'America/Chicago',  
                'honolulu': 'Pacific/Honolulu',  
                'hawaii': 'Pacific/Honolulu',  
                'anchorage': 'America/Anchorage',  
                'alaska': 'America/Anchorage',  
                  
                // UK/Europe  
                'london': 'Europe/London',  
                'uk': 'Europe/London',  
                'britain': 'Europe/London',  
                'england': 'Europe/London',  
                'manchester': 'Europe/London',  
                'birmingham': 'Europe/London',  
                'liverpool': 'Europe/London',  
                'leeds': 'Europe/London',  
                'glasgow': 'Europe/London',  
                'edinburgh': 'Europe/London',  
                'belfast': 'Europe/London',  
                'cardiff': 'Europe/London',  
                'paris': 'Europe/Paris',  
                'france': 'Europe/Paris',  
                'berlin': 'Europe/Berlin',  
                'germany': 'Europe/Berlin',  
                'munich': 'Europe/Berlin',  
                'hamburg': 'Europe/Berlin',  
                'frankfurt': 'Europe/Berlin',  
                'rome': 'Europe/Rome',  
                'italy': 'Europe/Rome',  
                'milan': 'Europe/Rome',  
                'venice': 'Europe/Rome',  
                'madrid': 'Europe/Madrid',  
                'spain': 'Europe/Madrid',  
                'barcelona': 'Europe/Madrid',  
                'amsterdam': 'Europe/Amsterdam',  
                'netherlands': 'Europe/Amsterdam',  
                'brussels': 'Europe/Brussels',  
                'belgium': 'Europe/Brussels',  
                'vienna': 'Europe/Vienna',  
                'austria': 'Europe/Vienna',  
                'zurich': 'Europe/Zurich',  
                'switzerland': 'Europe/Zurich',  
                'stockholm': 'Europe/Stockholm',  
                'sweden': 'Europe/Stockholm',  
                'oslo': 'Europe/Oslo',  
                'norway': 'Europe/Oslo',  
                'copenhagen': 'Europe/Copenhagen',  
                'denmark': 'Europe/Copenhagen',  
                'helsinki': 'Europe/Helsinki',  
                'finland': 'Europe/Helsinki',  
                'lisbon': 'Europe/Lisbon',  
                'portugal': 'Europe/Lisbon',  
                'athens': 'Europe/Athens',  
                'greece': 'Europe/Athens',  
                'dublin': 'Europe/Dublin',  
                'ireland': 'Europe/Dublin',  
                'warsaw': 'Europe/Warsaw',  
                'poland': 'Europe/Warsaw',  
                'prague': 'Europe/Prague',  
                'czech': 'Europe/Prague',  
                'budapest': 'Europe/Budapest',  
                'hungary': 'Europe/Budapest',  
                'moscow': 'Europe/Moscow',  
                'russia': 'Europe/Moscow',  
                'istanbul': 'Europe/Istanbul',  
                'turkey': 'Europe/Istanbul',  
                  
                // Asia Pacific  
                'dubai': 'Asia/Dubai',  
                'uae': 'Asia/Dubai',  
                'abudhabi': 'Asia/Dubai',  
                'singapore': 'Asia/Singapore',  
                'sydney': 'Australia/Sydney',  
                'melbourne': 'Australia/Melbourne',  
                'australia': 'Australia/Sydney',  
                'perth': 'Australia/Perth',  
                'brisbane': 'Australia/Brisbane',  
                'adelaide': 'Australia/Adelaide',  
                'auckland': 'Pacific/Auckland',  
                'newzealand': 'Pacific/Auckland',  
                'tokyo': 'Asia/Tokyo',  
                'japan': 'Asia/Tokyo',  
                'osaka': 'Asia/Tokyo',  
                'kyoto': 'Asia/Tokyo',  
                'seoul': 'Asia/Seoul',  
                'korea': 'Asia/Seoul',  
                'beijing': 'Asia/Shanghai',  
                'china': 'Asia/Shanghai',  
                'shanghai': 'Asia/Shanghai',  
                'hongkong': 'Asia/Hong_Kong',  
                'taipei': 'Asia/Taipei',  
                'taiwan': 'Asia/Taipei',  
                'bangkok': 'Asia/Bangkok',  
                'thailand': 'Asia/Bangkok',  
                'kualalumpur': 'Asia/Kuala_Lumpur',  
                'malaysia': 'Asia/Kuala_Lumpur',  
                'jakarta': 'Asia/Jakarta',  
                'indonesia': 'Asia/Jakarta',  
                'manila': 'Asia/Manila',  
                'philippines': 'Asia/Manila',  
                'hanoi': 'Asia/Ho_Chi_Minh',  
                'vietnam': 'Asia/Ho_Chi_Minh',  
                'saigon': 'Asia/Ho_Chi_Minh',  
                'dhaka': 'Asia/Dhaka',  
                'bangladesh': 'Asia/Dhaka',  
                'islamabad': 'Asia/Karachi',  
                'pakistan': 'Asia/Karachi',  
                'karachi': 'Asia/Karachi',  
                'lahore': 'Asia/Karachi',  
                'colombo': 'Asia/Colombo',  
                'srilanka': 'Asia/Colombo',  
                'kathmandu': 'Asia/Kathmandu',  
                'nepal': 'Asia/Kathmandu',  
                  
                // Middle East/Africa  
                'riyadh': 'Asia/Riyadh',  
                'saudiarabia': 'Asia/Riyadh',  
                'doha': 'Asia/Qatar',  
                'qatar': 'Asia/Qatar',  
                'kuwait': 'Asia/Kuwait',  
                'bahrain': 'Asia/Bahrain',  
                'tehran': 'Asia/Tehran',  
                'iran': 'Asia/Tehran',  
                'baghdad': 'Asia/Baghdad',  
                'iraq': 'Asia/Baghdad',  
                'cairo': 'Africa/Cairo',  
                'egypt': 'Africa/Cairo',  
                'johannesburg': 'Africa/Johannesburg',  
                'southafrica': 'Africa/Johannesburg',  
                'capetown': 'Africa/Johannesburg',  
                'nairobi': 'Africa/Nairobi',  
                'kenya': 'Africa/Nairobi',  
                'lagos': 'Africa/Lagos',  
                'nigeria': 'Africa/Lagos',  
                'accra': 'Africa/Accra',  
                'ghana': 'Africa/Accra',  
                  
                // Canada  
                'toronto': 'America/Toronto',  
                'canada': 'America/Toronto',  
                'vancouver': 'America/Vancouver',  
                'montreal': 'America/Toronto',  
                'calgary': 'America/Edmonton',  
                'edmonton': 'America/Edmonton',  
                'ottawa': 'America/Toronto',  
                'winnipeg': 'America/Winnipeg',  
                'quebec': 'America/Toronto',  
                'halifax': 'America/Halifax',  
                  
                // South America  
                'saopaulo': 'America/Sao_Paulo',  
                'brazil': 'America/Sao_Paulo',  
                'riodejaneiro': 'America/Sao_Paulo',  
                'buenosaires': 'America/Argentina/Buenos_Aires',  
                'argentina': 'America/Argentina/Buenos_Aires',  
                'lima': 'America/Lima',  
                'peru': 'America/Lima',  
                'bogota': 'America/Bogota',  
                'colombia': 'America/Bogota',  
                'santiago': 'America/Santiago',  
                'chile': 'America/Santiago',  
                'mexicocity': 'America/Mexico_City',  
                'mexico': 'America/Mexico_City'  
              };  
                
              // Check if input matches any common timezone  
              const lowerInput = tzInput.toLowerCase();  
              if (commonTimezones[lowerInput]) {  
                suggestedTz = commonTimezones[lowerInput];  
              } else {  
                // Use the closest match function as fallback  
                suggestedTz = getClosestTimezone(tzInput);  
              }  
                
              if (suggestedTz) {  
                const time = moment.tz(suggestedTz);
                const txt = `Here's the correct timezone you might be looking for.\nTimezone: ${suggestedTz}\nDate: ${time.format('YYYY-MM-DD')}\nTime: ${time.format('HH:mm:ss')}\nUTC Offset: ${time.format('Z')}`;
                return await msg.reply(txt);  
              } else {  
                return await msg.reply(`Invalid timezone: ${tzInput}\nUse format: Continent/City\nExample: .time Asia/Kolkata`);  
              }  
            }  

            // If we have a valid timezone  
            const time = moment.tz(tzInput);  
            const txt = `*Timezone: ${tzInput}*\n` +  
                       `Date: ${time.format('YYYY-MM-DD')}\n` +  
                       `Time: ${time.format('HH:mm:ss')}\n` +  
                       `UTC Offset: ${time.format('Z')}`;  

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
            const prePrompt = "You are Eternity, an AI assistant. Give short, clear, and useful answers in 2-3 lines. Stay straight to the point, with no extra comments or explanations. you talk in English only ";  
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
          
        case 'carbon': {  
          try {  
            if (!args || args.length === 0) {  
              return msg.reply('Please provide some text to generate the code image.\nExample: .carbon console.log("Hello World")');  
            }  

            let codeText = args.join(' ');  

            const response = await fetch('https://carbonara.solopov.dev/api/cook', {  
              method: 'POST',  
              headers: {  
                'Content-Type': 'application/json',  
              },  
              body: JSON.stringify({  
                code: codeText,  
                backgroundColor: '#1F816D',  
                theme: 'dracula',  
                language: 'auto',  
                                windowTheme: 'none',
                fontFamily: 'Hack',
                fontSize: '14px',
                lineNumbers: false,
                widthAdjustment: true,
                lineHeight: '133%',
                paddingVertical: '56px',
                paddingHorizontal: '56px',
                dropShadow: true,
                dropShadowOffsetY: '20px',
                dropShadowBlurRadius: '68px',
                exportSize: '2x',
                watermark: false
              }),  
            });  

            if (!response.ok) {  
              throw new Error('Failed to generate the code image.');  
            }  

            // Convert response to buffer  
            const arrayBuffer = await response.arrayBuffer();  
            const buffer = Buffer.from(arrayBuffer);  
              
            // Send the image  
            await sock.sendMessage(msg.from, {  
              image: buffer,  
              caption: 'ðŸ¦‡ Here is your code image!'  
            }, { quoted: m });  

          } catch (error) {  
            console.error('Carbon Command Error:', error);  
            await msg.reply('An error occurred while generating the code image. Please try again later.');  
          }  
          break;  
        }  
          
        case 'removebg':
        case 'rmbg': {
          try {
            if (!m.message?.imageMessage && !m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage)
              return msg.reply('Please reply to a PNG or JPG image, or send one with caption .removebg');

            let imageBuffer;
            let mimetype;

            if (m.message.imageMessage) {
              imageBuffer = await sock.downloadMediaMessage(m);
              mimetype = m.message.imageMessage.mimetype;
            } else if (m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
              const quotedMsg = {
                key: {
                  remoteJid: m.key.remoteJid,
                  id: m.message.extendedTextMessage.contextInfo.stanzaId,
                  participant: m.message.extendedTextMessage.contextInfo.participant
                },
                message: m.message.extendedTextMessage.contextInfo.quotedMessage
              };
              imageBuffer = await sock.downloadMediaMessage(quotedMsg);
              mimetype = quotedMsg.message.imageMessage.mimetype;
            }

            if (!imageBuffer) return msg.reply('Failed to download the image.');

            if (!mimetype || (!mimetype.includes('png') && !mimetype.includes('jpeg')))
              return msg.reply('Only PNG or JPG images are supported!');

            const extension = mimetype.includes('png') ? 'png' : 'jpg';

            const FormData = (await import('form-data')).default;
            const form = new FormData();
            form.append('image_file', imageBuffer, { filename: `image.${extension}` });

            const response = await axios.post(
              'https://api.naxordeve.qzz.io/media/removebg',
              form,
              { headers: { ...form.getHeaders() }, responseType: 'arraybuffer', timeout: 20000 }
            );

            if (response.status !== 200) throw new Error(`API returned status: ${response.status}`);

            await sock.sendMessage(
              msg.from,
              { image: response.data, caption: 'âœ¨ Background removed successfully!\nMADE BY ETERNITY' },
              { quoted: m }
            );

          } catch (e) {
            console.error('RemoveBG Command Error:', e);
            await msg.reply(`Oops! Something went wrong while removing the background.\n${e.message}`);
          }
          break;
        }
              
            case 'imagine': {
    try {
        let prompt = match && match.trim() ? match.trim() : null;
        if (!prompt) return await message.send("_Please provide a prompt_");

        const res = await axios.get(`https://api.naxordeve.qzz.io/media/generate?prompt=${encodeURIComponent(prompt)}`, { 
            responseType: "arraybuffer" 
        });

        await message.send({ image: res.data, caption: prompt });
    } catch (e) {
        console.error("Image generation error:", e.message);
        await message.send("_Failed to generate image. Try again later._");
    }
    break;



              
              /*case 'fluxai':
case 'flux':
case 'imagine': {
    if (!q) return reply("Please provide a prompt for the image.");
    await reply("> *CREATING IMAGINE ...ðŸ”¥*");
    try {
        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

        if (!response || !response.data) return reply("Error: The API did not return a valid image. Try again later.");

        const imageBuffer = Buffer.from(response.data, "binary");
        await conn.sendMessage(m.chat, { image: imageBuffer, caption: `ðŸ’¸ *Imagine Generated By TOHID_MD* ðŸš€\nâœ¨ Prompt: *${q}*` });
    } catch (error) {
        console.error("FluxAI Error:", error);
        reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
    }
    break;
}

case 'stablediffusion':
case 'sdiffusion':
case 'imagine2': {
    if (!q) return reply("Please provide a prompt for the image.");
    await reply("> *CREATING IMAGINE ...ðŸ”¥*");
    try {
        const apiUrl = `https://api.siputzx.my.id/api/ai/stable-diffusion?prompt=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

        if (!response || !response.data) return reply("Error: The API did not return a valid image. Try again later.");

        const imageBuffer = Buffer.from(response.data, "binary");
        await conn.sendMessage(m.chat, { image: imageBuffer, caption: `ðŸ’¸ *Imagine Generated By TOHID_MD* ðŸš€\nâœ¨ Prompt: *${q}*` });
    } catch (error) {
        console.error("StableDiffusion Error:", error);
        reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
    }
    break;
}

case 'stabilityai':
case 'stability':
case 'imagine3': {
    if (!q) return reply("Please provide a prompt for the image.");
    await reply("> *CREATING IMAGINE ...ðŸ”¥*");
    try {
        const apiUrl = `https://api.siputzx.my.id/api/ai/stabilityai?prompt=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { responseType: "arraybuffer" });

        if (!response || !response.data) return reply("Error: The API did not return a valid image. Try again later.");

        const imageBuffer = Buffer.from(response.data, "binary");
        await conn.sendMessage(m.chat, { image: imageBuffer, caption: `ðŸ’¸ *Imagine Generated By ETERNITY* ðŸš€\nâœ¨ Prompt: *${q}*` });
    } catch (error) {
        console.error("StabilityAI Error:", error);
        reply(`An error occurred: ${error.response?.data?.message || error.message || "Unknown error"}`);
    }
    break;
}*/
        
                  
      
  
          
        }
              
        case 'weather':
        case 'climate':
        case 'mosam': {
          try {
            if (!args.length) return msg.reply('*ðŸŒ¼ Please provide a city to search*');

            const city = args.join(' '); // Join args into a string
            const apiKey = '060a6bcfa19809c2cd4d97a212b19273';
            const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`);
            const data = response.data;

            if (!data || !data.name) return msg.reply('âŒ Could not find weather for that location.');

            const name = data.name;
            const country = data.sys?.country || 'N/A';
            const weatherDesc = data.weather?.[0]?.description || 'N/A';
            const temp = data.main?.temp != null ? `${data.main.temp}Â°C` : 'N/A';
            const minTemp = data.main?.temp_min != null ? `${data.main.temp_min}Â°C` : 'N/A';
            const maxTemp = data.main?.temp_max != null ? `${data.main.temp_max}Â°C` : 'N/A';
            const humidity = data.main?.humidity != null ? `${data.main.humidity}%` : 'N/A';
            const wind = data.wind?.speed != null ? `${data.wind.speed} km/h` : 'N/A';

            const wea = `Êœá´‡Ê€á´‡ Éªs á´›Êœá´‡ á´¡á´‡á´€á´›Êœá´‡Ê€ á´Ò“ ${name}\n\n` +
                        `ã€Œ ðŸŒ… ã€ Place: ${name}\n` +
                        `ã€Œ ðŸ—ºï¸ ã€ Country: ${country}\n` +
                        `ã€Œ ðŸŒ¤ï¸ ã€ Weather: ${weatherDesc}\n` +
                        `ã€Œ ðŸŒ¡ï¸ ã€ Temperature: ${temp}\n` +
                        `ã€Œ ðŸ’  ã€ Min Temp: ${minTemp}\n` +
                        `ã€Œ ðŸ”¥ ã€ Max Temp: ${maxTemp}\n` +
                        `ã€Œ ðŸ’¦ ã€ Humidity: ${humidity}\n` +
                        `ã€Œ ðŸŒ¬ï¸ ã€ Wind Speed: ${wind}`;

            await msg.reply(wea);

          } catch (e) {
            console.error('Weather Command Error:', e);
            await msg.reply('*âŒ Failed to fetch weather info. Make sure the city name is correct.*');
          }
          break;
        }
              
              
          

case 'connect4': {
    if (!message.isGroup) return;
    const mention = message.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (!mention) return await message.send('_Please mention a user to challenge_');
    if (game.has(message.from)) return await message.send('A game is already in progress');

    const board = Array.from({ length: 6 }, () => Array(7).fill('âšª')); // 6 rows, 7 columns
    const info = {
        board,
        player1: message.sender,
        player2: mention,
        current: null,
        started: false,
        timeoutId: null
    };

    info.timeoutId = setTimeout(() => {
        if (game.has(message.from) && !info.started) {
            game.delete(message.from);
            message.send('â³ _Game canceled: challenger did not accept in time_');
        }
    }, 60 * 1000);

    game.set(message.from, info);
    await message.send(`ðŸŽ® *Connect Four Challenge*\n\nðŸ‘¤ ${mention.split('@')[0]}, type *join* to accept the challenge!`, { mentions: [mention] });
    break;
}

// Global text handler for gameplay
case 'connect4-play': {
    const session = game.get(message.from);
    if (!session) return;

    const { player1, player2, board, started, timeoutId } = session;
    const sender = message.sender;
    const body = message.body.trim().toLowerCase();

    const ctx = (board) => {
        const cols = ['1ï¸âƒ£','2ï¸âƒ£','3ï¸âƒ£','4ï¸âƒ£','5ï¸âƒ£','6ï¸âƒ£','7ï¸âƒ£'];
        let str = 'ðŸŽ¯ *Connect Four*\n\n';
        for (let r = 0; r < 6; r++) {
            str += 'â”‚ ';
            for (let c = 0; c < 7; c++) {
                str += board[r][c] + ' ';
            }
            str += 'â”‚\n';
        }
        str += 'â””' + 'â”€â”€â”€'.repeat(7) + 'â”˜\n'; // bottom border
        str += cols.join(' ') + '\n'; // column numbers
        return str;
    };

    const checkWin = (board, token) => {
        const ROWS = 6, COLS = 7;
        // Horizontal
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c <= COLS - 4; c++) {
                if (board[r][c] === token && board[r][c+1] === token && board[r][c+2] === token && board[r][c+3] === token) return true;
            }
        }
        // Vertical
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r <= ROWS - 4; r++) {
                if (board[r][c] === token && board[r+1][c] === token && board[r+2][c] === token && board[r+3][c] === token) return true;
            }
        }
        // Diagonal \
        for (let r = 0; r <= ROWS - 4; r++) {
            for (let c = 0; c <= COLS - 4; c++) {
                if (board[r][c] === token && board[r+1][c+1] === token && board[r+2][c+2] === token && board[r+3][c+3] === token) return true;
            }
        }
        // Diagonal /
        for (let r = 0; r <= ROWS - 4; r++) {
            for (let c = 3; c < COLS; c++) {
                if (board[r][c] === token && board[r+1][c-1] === token && board[r+2][c-2] === token && board[r+3][c-3] === token) return true;
            }
        }
        return false;
    };

    if (!started) {
        if (sender === player2 && body === 'join') {
            clearTimeout(timeoutId);
            session.started = true;
            session.current = player1;
            const view = ctx(board) +
                `\nðŸ”´ <${player1.split('@')[0]}> vs ðŸŸ¡ <${player2.split('@')[0]}>\n\nðŸ”´ *${player1.split('@')[0]}* starts`;
            return await message.send(view, { mentions: [player1, player2] });
        }
        return;
    }

    if (body === 'surrender') {
        if (sender !== player1 && sender !== player2) return;
        const opponent = sender === player1 ? player2 : player1;
        game.delete(message.from);
        return await message.send(`ðŸ’€ *${sender.split('@')[0]} surrendered*\nðŸ† *${opponent.split('@')[0]} wins!*`, { mentions: [sender, opponent] });
    }

    if (sender !== session.current) return;
    if (!/^[1-7]$/.test(body)) return await message.reply('âŒ Please reply with a column number between 1ï¸âƒ£ and 7ï¸âƒ£');

    const col = parseInt(body) - 1;
    for (let row = 5; row >= 0; row--) {
        if (!board[row][col]) {
            board[row][col] = sender === player1 ? 'ðŸ”´' : 'ðŸŸ¡';
            if (checkWin(board, board[row][col])) {
                const result = ctx(board) +
                    `\nðŸ”´ <${player1.split('@')[0]}> vs ðŸŸ¡ <${player2.split('@')[0]}>\n\nðŸŽ‰ *${sender.split('@')[0]} wins!*`;
                game.delete(message.from);
                return await message.send(result, { mentions: [player1, player2] });
            }

            if (board.every(r => r.every(cell => cell))) {
                const draw = ctx(board) +
                    `\nðŸ”´ <${player1.split('@')[0]}> vs ðŸŸ¡ <${player2.split('@')[0]}>\n\nðŸ¤ *It's a draw!*`;
                game.delete(message.from);
                return await message.send(draw, { mentions: [player1, player2] });
            }

            session.current = sender === player1 ? player2 : player1;
            const turn = ctx(board) +
                `\nðŸ”´ <${player1.split('@')[0]}> vs ðŸŸ¡ <${player2.split('@')[0]}>\n\nðŸŽ¯ *${session.current.split('@')[0]}'s turn*`;
            return await message.send(turn, { mentions: [player1, player2] });
        }
    }

    return await message.send('âš ï¸ This column is full. Choose another one');
    break;
}
        
        case 'animequiz': 
        case 'aeqz': {
          if (!msg.isGroup) return msg.reply('_This command only works in groups!_');
          if (game.has(msg.from)) return msg.reply('_A quiz is already running in this group!_');

          // Fetch questions from your GitHub raw file
          const fetchAnimeQuestions = async () => {
            try {
              // Using the new URL
              const response = await fetch('https://raw.githubusercontent.com/PhoenixFury0000/Zrux_Crunchyroll_Bot/refs/heads/main/quiz/anime-quiz.txt%20');
              
              if (!response.ok) {
                console.error('Failed to fetch questions:', response.status);
                return [];
              }
              
              const data = await response.text();
              console.log('Quiz data loaded successfully');
              
              const blocks = data.split('\n\n');
              const questions = [];

              for (const block of blocks) {
                if (!block.trim()) continue;
                const lines = block.split('\n');
                let question = '', options = [], answer = '';
                
                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.startsWith('Question:')) {
                    question = trimmedLine.replace('Question:', '').trim();
                  } else if (trimmedLine.startsWith('Options:')) {
                    const optionsStr = trimmedLine.replace('Options:', '').trim();
                    options = optionsStr.split(',').map(opt => opt.trim());
                  } else if (trimmedLine.startsWith('Answer:')) {
                    answer = trimmedLine.replace('Answer:', '').trim();
                  }
                }
                
                // Validate the question data
                if (question && options.length === 4 && answer) {
                  questions.push({ question, options, answer });
                } else {
                  console.warn('Skipping invalid question block:', block);
                }
              }
              
              console.log('Total questions found:', questions.length);
              return questions;
            } catch (err) {
              console.error('Error fetching anime questions:', err);
              return [];
            }
          };

          const allQuestions = await fetchAnimeQuestions();
          if (!allQuestions.length) return msg.reply('_No questions found or error loading questions!_');

          const count = Math.min(parseInt(args[0]) || 6, allQuestions.length);
          const shuffled = allQuestions.sort(() => Math.random() - 0.5).slice(0, count);

          const session = {
            starter: msg.sender,
            score: 0,
            lives: 3,
            total: 0,  // Start with 0 (first question)
            max: count,
            questions: shuffled,
            current: shuffled[0],
            groupId: msg.from
          };

          game.set(msg.from, session);
          console.log('Quiz started in group:', msg.from);

          const optionsText = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
          const content = `ðŸŽ´ *Anime Quiz Game*\n\nðŸŒ¼ *Question:*\n${session.current.question}\n\nðŸŽ¯ *Options:*\n${optionsText}\n\nðŸ¦‡ *Lives:* ${session.lives}\nðŸŽ– *Score:* ${session.score}\nðŸŽƒ *Question:* ${session.total + 1}/${session.max}\n\n*ðŸ’­ Reply with the correct number (1-4) or type the answer*`;

          await msg.reply(content);
          break;
        }
              
        default: {
          // Check if this is a quiz answer
          if (game.has(msg.from)) {
            const session = game.get(msg.from);
            console.log('Processing answer from:', msg.sender, 'for session:', session.starter);
            
            // Only the quiz starter should answer in this implementation
            if (msg.sender !== session.starter) {
              console.log('Ignoring answer from non-starter');
              return;
            }
            
            const body = msg.body.trim();
            const options = session.current.options;
            const correct = session.current.answer;

            console.log('Received answer:', body);
            console.log('Correct answer:', correct);

            // Check number or text, case-insensitive
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
              feedback = 'âœ… *Correct*';
            } else {
              session.lives--;
              feedback = `âŒ *Wrong*\nâœ… *Answer:* ${correct}`;
            }

            // Check if game should end
            if (session.lives === 0 || session.total + 1 >= session.max) {
              game.delete(msg.from);
              console.log('Game ended in group:', msg.from);
              return msg.reply(`ðŸ‘» *Game Over*\n\nðŸŽ– *Final Score:* ${session.score} / ${session.total + 1}`);
            }

            // Move to next question
            session.total++;
            session.current = session.questions[session.total];

            const nextOptions = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
            const q = `${feedback}\n\nðŸŒ¼ *Question:*\n${session.current.question}\n\nðŸŽ¯ *Options:*\n${nextOptions}\n\nðŸ‘» *Lives:* ${session.lives}\nðŸŽ– *Score:* ${session.score}\nðŸŽƒ *Question:* ${session.total + 1}/${session.max}\n\n*ðŸ’­ Reply with the correct number (1-4) or type the answer*`;

            await msg.reply(q);
          }
          break;
        }
              
              case 'ttt':
case 'tictactoe': {
    // Helpers / fallbacks (keep if your handler doesn't provide them)
    const chatId = (typeof m !== 'undefined' && (m.chat || m.from)) || (typeof msg !== 'undefined' && (msg.chat || msg.from)) || '';
    const senderId = (typeof m !== 'undefined' && (m.sender || m.from)) || (typeof msg !== 'undefined' && (msg.sender || msg.from)) || '';

    // fallback to args if your framework already provides it
    const rawBody = (typeof m !== 'undefined' && (m.text || m.body || (m.message && (m.message.conversation || m.message.extendedTextMessage?.text)))) ||
                    (typeof msg !== 'undefined' && (msg.text || msg.body)) || '';
    const parts = String(rawBody || '').trim().split(/\s+/);
    const argsLocal = (typeof args !== 'undefined' && args.length) ? args : parts.slice(1);

    // Ensure global store
    global.tttGames = global.tttGames || new Map();

    // Game class (stores player JIDs and board bits)
    class TicTacToe {
        constructor(playerXId, playerOId) {
            this.playerX = playerXId;   // X (starts)
            this.playerO = playerOId;   // O (second player or 'BOT')
            this._x = 0;
            this._o = 0;
            this.turns = 0;
            this.isOturn = false; // false -> X to play; true -> O to play
        }

        get currentPlayerId() {
            return this.isOturn ? this.playerO : this.playerX;
        }

        get currentPlayerSymbol() {
            return this.isOturn ? 'O' : 'X';
        }

        get patterns() {
            return [
                0b111000000, 0b000111000, 0b000000111,
                0b100100100, 0b010010010, 0b001001001,
                0b100010001, 0b001010100
            ];
        }

        winner() {
            for (let p of this.patterns) {
                if ((this._x & p) === p) return this.playerX;
                if ((this._o & p) === p) return this.playerO;
            }
            return null;
        }

        isFull() {
            return this.turns >= 9;
        }

        isTaken(pos) {
            const bit = 1 << pos;
            return ((this._x | this._o) & bit) !== 0;
        }

        // pos is 0..8
        play(pos) {
            if (this.winner() || pos < 0 || pos > 8) return -1; // invalid
            if (this.isTaken(pos)) return 0; // taken

            const v = 1 << pos;
            if (this.isOturn) this._o |= v;
            else this._x |= v;

            this.turns++;
            this.isOturn = !this.isOturn;
            return 1; // ok
        }

        renderBoard() {
            const cells = [...Array(9)].map((_, i) => {
                const bit = 1 << i;
                return (this._x & bit) ? 'âŒ' : (this._o & bit) ? 'â­•' : (i + 1).toString();
            });
            return `${cells[0]} | ${cells[1]} | ${cells[2]}\n${cells[3]} | ${cells[4]} | ${cells[5]}\n${cells[6]} | ${cells[7]} | ${cells[8]}`;
        }

        availableMoves() {
            const moves = [];
            for (let i = 0; i < 9; i++) if (!this.isTaken(i)) moves.push(i);
            return moves;
        }

        // helper to test if symbol would win when putting at pos
        winsIfPlay(pos, symbolIsO) {
            const x = this._x;
            const o = this._o;
            const v = 1 << pos;
            const tx = symbolIsO ? x : (x | v);
            const to = symbolIsO ? (o | v) : o;
            for (let p of this.patterns) {
                if ((tx & p) === p) return this.playerX === (symbolIsO ? null : this.playerX) && !symbolIsO; // dummy, we won't use tx path for X
                // simpler: check with current bits
            }
            // We'll actually use a simpler check externally
            return false;
        }
    }

    // Simple helper to send reply (tries common reply methods)
    function sendReply(text) {
        if (m && typeof m.reply === 'function') return m.reply(text);
        if (typeof reply === 'function') return reply(text);
        if (msg && typeof msg.reply === 'function') return msg.reply(text);
        console.log('[TTT reply] ' + text);
    }

    // If no args -> show help
    if (!argsLocal[0]) {
        sendReply(`Commands are:\n\n.ttt --bot    â†’ Play with bot (you start as âŒ)\n\n.ttt --end    â†’ Cancel the current game in this chat`);
        break;
    }

    const sub = argsLocal[0].toLowerCase();

    // start vs bot
    if (sub === '--bot') {
        if (global.tttGames.has(chatId)) return sendReply('A TicTacToe game is already running in this chat. Use `.ttt --end` to cancel it first.');
        const game = new TicTacToe(senderId, 'BOT');
        global.tttGames.set(chatId, { game, botMode: true, creator: senderId });
        sendReply(`ðŸŽ® TicTacToe vs BOT started!\n\n${game.renderBoard()}\n\nReply with 1-9 to play (you are âŒ).`);
        break;
    }

    // start player vs player (tag someone)
    if (sub === '--player') {
        // try to detect mentioned JID
        const mentioned = (m && m.mentionedJid && m.mentionedJid[0]) || (typeof mentionedJid !== 'undefined' && mentionedJid && mentionedJid[0]) || null;
        if (!mentioned) return sendReply('Tag the player to challenge. Usage: `.ttt --player @user`');
        if (mentioned === senderId) return sendReply('You cannot challenge yourself.');
        if (global.tttGames.has(chatId)) return sendReply('A TicTacToe game is already running here. Use `.ttt --end` to cancel it first.');
        const game = new TicTacToe(senderId, 'WAITING'); // WAITING until join
        global.tttGames.set(chatId, { game, botMode: false, challenger: senderId, waitingJoin: true });
        sendReply(`ðŸŽ® TicTacToe challenge sent!\n\n${mentioned} â€” reply with "join" to accept the challenge.\n\n${game.renderBoard()}`);
        break;
    }

    // cancel a running game
    if (sub === '--end') {
        if (!global.tttGames.has(chatId)) return sendReply('No TicTacToe game running in this chat.');
        global.tttGames.delete(chatId);
        sendReply('TicTacToe game cancelled.');
        break;
    }

    // unknown arg
    sendReply('Unknown subcommand. Use `.ttt` to see commands.');
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
      console.log('âœ…ï¸ Phoenix Connected');  
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

// Start the bot
Phoenix();