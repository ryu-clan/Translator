import fetch from 'node-fetch';

export const tre = {
  name: 'tre',
  description: 'Translate text using AI',
  usage: '.tre <text>',
  
  async execute(msg, args, { sock, m, config }) {
    try {    
      if (!args || args.length === 0) {    
        return msg.reply("Please provide a text to translate .");    
      }    
      
      const prePrompt = "You are a translator. Translate any input text to clear, correct English only. Do not add explanations, comments, or extra messages. ";    
      const userQuestion = args.join(' ');    
      const res = await fetch("https://api.naxordeve.qzz.io/ai/chatgpt_3.5_scr1", {    
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
      await msg.reply(data.answer || "_oops_");    
    } catch (e) {    
      console.error(e);    
      await msg.reply("_err_");    
    }
  }
};
