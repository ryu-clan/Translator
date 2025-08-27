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
          feedback = '✅ *Correct*';
        } else {
          session.lives--;
          feedback = `❌ *Wrong*\n✅ *Answer:* ${correct}`;
        }

        // Check if game should end
        if (session.lives === 0 || session.total + 1 >= session.max) {
          game.delete(msg.from);
          console.log('Game ended in group:', msg.from);
          await msg.reply(`🛑 *Game Over*\n\n🏅 *Final Score:* ${session.score} / ${session.total + 1}`);
          return; // End here if game is over
        }

        // Move to next question
        session.total++;
        session.current = session.questions[session.total];

        const nextOptions = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        const q = `${feedback ? `💡 *Hint:* ${feedback}\n\n` : ''}  
🎮 *Next Challenge Awaits!*  
🧠 *Question:* ${session.current.question}  

🎯 *Choices:*  
${nextOptions}  

${session.lives > 0 
    ? `❤️ *Lives:* ${'❤'.repeat(session.lives)} (${session.lives} left)` 
    : '💀 *No lives left — clutch time!*'}  
🏆 *Score:* ${session.score} | 📋 *Round:* ${session.total + 1}/${session.max}  

⚡ *Your Move:* Drop the right *number (1-4)* or type the *answer* like a boss.`;

        await msg.reply(q);
        return; // Return after processing quiz answer
        
      } catch (error) {
        console.error('Quiz answer processing error:', error);
        game.delete(msg.from); // Clear the session on error
        await msg.reply('❌ An error occurred in the quiz. The game has been reset.');
      }
    }

    // Only process commands if message starts with prefix
    if (msg.body.startsWith(config.prefix)) {    
      const args = msg.body.slice(config.prefix.length).trim().split(' ');    
      const cmd = args.shift().toLowerCase();    
      
      switch (cmd) {    
        case 'ping': {    
          const start = Date.now();    
          await msg.reply(` ㅤㅤㅤ`);    
          const end = Date.now();    
          msg.reply(` 🎃 speed: ${end - start}ms`);    
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
            msg.reply(`--------[ ♧ Eternity Fun Section ♧ ]---------
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
            msg.reply(`--------[ ♧ Eternity ♧ ]---------
> .ping  ~ Latency Check
> .alive ~ Bot Status
> .menu --fun ~ Fun Commands
> .define ~ Urban Dictionary lookup
> .animequiz ~ Anime trivia game
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
            const definition = entry.definition.replace(/|/g, '');  
            const example = entry.example?.replace(/|/g, '') || 'No example';  

            const text = `${word} - eternity Dictionary

🔖– Definition:
${definition}

🎃¡ Example:
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
              caption: '🦇 Here is your code image!'  
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
              { image: response.data, caption: '✨ Background removed successfully!\nMADE BY ETERNITY' },
              { quoted: m }
            );

          } catch (e) {
            console.error('RemoveBG Command Error:', e);
            await msg.reply(`Oops! Something went wrong while removing the background.\n${e.message}`);
          }
          break;
        }
                  
        case 'readviewonce':
        case 'read':
        case 'vv':
        case 'rvo': {
          try {
            const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');

            if (!m.message?.extendedTextMessage?.contextInfo?.quotedMessage) 
              return msg.reply('✳️❇️ Its Not a ViewOnce Message');

            const quoted = m.message.extendedTextMessage.contextInfo.quotedMessage;

            if (!/viewOnce/.test(Object.keys(quoted)[0])) 
              return msg.reply('✳️❇️ Its Not a ViewOnce Message');

            const mtype = Object.keys(quoted)[0];

            // Download the media content
            const stream = await downloadContentFromMessage(quoted[mtype], mtype.replace(/Message/, ''));
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const caption = quoted[mtype].caption || '';
            await sock.sendMessage(msg.from, { 
              [mtype.replace(/Message/, '')]: buffer, 
              caption 
            }, { quoted: m });

          } catch (e) {
            console.error('ReadViewOnce Error:', e);
            await msg.reply('_Failed to read view-once message_');
          }
          break;
        }
              
        case 'weather':
        case 'climate':
        case 'mosam': {
          try {
            if (!args.length) return msg.reply('*✳️ Please provide a city to search*');

            const city = args.join(' '); // Join args into a string
            const apiKey = '060a6bcfa19809c2cd4d97a212b19273';
            const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`);
            const data = response.data;

            if (!data || !data.name) return msg.reply('❌ Could not find weather for that location.');

            const name = data.name;
            const country = data.sys?.country || 'N/A';
            const weatherDesc = data.weather?.[0]?.description || 'N/A';
            const temp = data.main?.temp != null ? `${data.main.temp}°C` : 'N/A';
            const minTemp = data.main?.temp_min != null ? `${data.main.temp_min}°C` : 'N/A';
            const maxTemp = data.main?.temp_max != null ? `${data.main.temp_max}°C` : 'N/A';
            const humidity = data.main?.humidity != null ? `${data.main.humidity}%` : 'N/A';
            const wind = data.wind?.speed != null ? `${data.wind.speed} km/h` : 'N/A';

            const wea = `ʜᴇʀᴇ ɪs ᴛʜᴇ ᴡᴇᴀᴛʜᴇʀ ᴏғ ${name}\n\n` +
                        `「 🌅 」 Place: ${name}\n` +
                        `「 🗺️ 」 Country: ${country}\n` +
                        `「 🌤️ 」 Weather: ${weatherDesc}\n` +
                        `「 🌡️ 」 Temperature: ${temp}\n` +
                        `「 💠 」 Min Temp: ${minTemp}\n` +
                        `「 🔥 」 Max Temp: ${maxTemp}\n` +
                        `「 💦 」 Humidity: ${humidity}\n` +
                        `「 🌬️ 」 Wind Speed: ${wind}`;

            await msg.reply(wea);

          } catch (e) {
            console.error('Weather Command Error:', e);
            await msg.reply('*❌ Failed to fetch weather info. Make sure the city name is correct.*');
          }
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
          const content = `🎌 *Anime Quiz Game*\n\n🧠 *Question:*\n${session.current.question}\n\n🎯 *Options:*\n${optionsText}\n\n❤️ *Lives:* ${session.lives}\n🏅 *Score:* ${session.score}\n📋 *Question:* ${session.total + 1}/${session.max}\n\n*💬 Reply with the correct number (1-4) or type the answer*`;

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
              feedback = '✅ *Correct*';
            } else {
              session.lives--;
              feedback = `❌ *Wrong*\n✅ *Answer:* ${correct}`;
            }

            // Check if game should end
            if (session.lives === 0 || session.total + 1 >= session.max) {
              game.delete(msg.from);
              console.log('Game ended in group:', msg.from);
              return msg.reply(`🛑 *Game Over*\n\n🏅 *Final Score:* ${session.score} / ${session.total + 1}`);
            }

            // Move to next question
            session.total++;
            session.current = session.questions[session.total];

            const nextOptions = session.current.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
            const q = `${feedback}\n\n🧠 *Question:*\n${session.current.question}\n\n🎯 *Options:*\n${nextOptions}\n\n❤️ *Lives:* ${session.lives}\n🏅 *Score:* ${session.score}\n📋 *Question:* ${session.total + 1}/${session.max}\n\n*💬 Reply with the correct number (1-4) or type the answer*`;

            await msg.reply(q);
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

// Start the bot
Phoenix();