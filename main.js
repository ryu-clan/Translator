import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from '@whiskeysockets/baileys'
import P from 'pino'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import translate from '@vitalets/google-translate-api'
import { Boom } from '@hapi/boom'
import { fileURLToPath } from 'url'
import { SessionCode } from './session.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
function serialize(sock, m) {
  const type = Object.keys(m.message)[0]
  const body =
    m.message.conversation ||
    m.message[type]?.text ||
    m.message[type]?.caption ||
    ''
  const from = m.key.remoteJid
  const sender = m.key.participant || from
  const isGroup = from.endsWith('@g.us')
  return {
    id: m.key.id,
    from,
    sender,
    body,
    isGroup,
    reply: (text) => sock.sendMessage(from, { text }, { quoted: m }),
    download: async () => {
      const stream = await downloadContentFromMessage(
        m.message[type],
        type.replace('Message', '')
      )
      let buffer = Buffer.from([])
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])
      return buffer
    }
  }
}

async function tr_txt(text, to = 'en') {
  try {const res = await axios.get(
      `https://api.naxordeve.qzz.io/tools/translate?text=${
        text
      }&to=${to}`
    )
    if (res.data?.ok) return res.data.result || res.data.text
  } catch {}
  const result = await translate(text, { to })
  return result.text
}

async function Pheonix() {
  await SessionCode(config.SESSION_ID || process.env.SESSION_ID, './lib/Session');
  const sessionDir = path.join(__dirname, 'Session');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
  const logga = pino({ level: 'silent' });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    auth: { creds },
    version
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.remoteJid === 'status@broadcast') return
    const msg = serialize(sock, m)
    if (msg.isGroup && msg.body && !msg.body.startsWith('.')) {
      try {const translated = await tr_txt(msg.body, 'en')
        if (translated.toLowerCase() !== msg.body.toLowerCase()) {
          msg.reply(`*Tr*:\n${translated}`)
        }
      } catch {}
    }

    if (msg.body.startsWith('.')) {
      const cmd = msg.body.slice(1).trim().split(' ')[0].toLowerCase()
      switch (cmd) {
        case 'ping': {
          const start = Date.now()
          await msg.reply('Speed...')
          const end = Date.now() it 
          msg.reply(`🏓Latency: ${end - start}ms`)
          break
        }
        case 'alive':
          msg.reply('*I am alive and running*')
          break
        case 'menu':
          msg.reply(
            `Menu:\n\n.ping -\n.alive -\n.menu -\n(Auto-translate)\n\n*Phoenix Bot*`
          )
          break
      }
    }
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error).output?.statusCode
      if (code !== DisconnectReason.loggedOut) {
        console.log('Disconnected, reconnecting in 5s...')
        setTimeout(Phoenix, 5000)
      } else {
        console.log('Logged out, remove auth_info and re-run SessionCode')
      }} else if (connection === 'open') {
      console.log('✅ Connected')
      try {const id = sock.user?.id
        if (id) {
          await sock.sendMessage(id, { text: '*connected successfully*' })
        }
      } catch (e) {
        console.error(e)
      }
    }
  })
  }
