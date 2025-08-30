export const status = {
  name: 'status',
  description: 'Get WhatsApp status of a user',
  usage: '.status [@user|phone_number]',
  
  async execute(msg, args, { sock, m, config }) {
    try {
      let userJid;
      if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {  
        userJid = m.message.extendedTextMessage.contextInfo.mentionedJid[0];  
      } else if (m.message?.extendedTextMessage?.contextInfo?.participant) {  
        userJid = m.message.extendedTextMessage.contextInfo.participant;  
      } else if (args.length > 0) {  
        let num = args[0].replace(/[^0-9]/g, '');  
        if (num.startsWith('0')) {  
          num = num.substring(1);  
        }  
        userJid = num + '@s.whatsapp.net';  
      } else {  
        userJid = m.key.participant || m.key.remoteJid;  
      }  
      
      const status = await sock.fetchStatus(userJid).catch(() => null);  
      if (!status || !status.status) {  
        return await sock.sendMessage(msg.from, {  
          text: '_No status set for this user_'  
        }, { quoted: m });  
      }  
    
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
  }
};
