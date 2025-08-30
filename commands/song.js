import axios from 'axios';

export const song = {
  name: 'song',
  description: 'Download songs from YouTube',
  usage: '.song <song name>',
  
  async execute(msg, args, { sock, m, config }) {
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
  }
};
