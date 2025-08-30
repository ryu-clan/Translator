import fetch from 'node-fetch';

export const define = {
  name: 'define',
  description: 'Get word definition from Urban Dictionary',
  usage: '.define <word>',
  
  async execute(msg, args, { sock, m, config }) {
    try {
      if (!args.length) return await msg.reply(`Usage: ${config.prefix}define <word>`);
      const word = args.join(' ');  
      const response = await fetch(`https://api.urbandictionary.com/v0/define?term=${word}`);  
      const data = await response.json();  
      if (!data.list?.length) return await msg.reply(`_No definition found for "${word}"_`);  
      const entry = data.list[0];  
      const definition = entry.definition.replace(/\[|\]/g, '');  
      const example = entry.example?.replace(/\[|\]/g, '') || 'No example';  
      const text = `${word} - eternity Dictionary

🔖– Definition:
${definition}

🎃¡ Example:
${example}`;

      await msg.reply(text);

    } catch (error) {
      console.error(error);
      await msg.reply('Failed to fetch definition');
    }
  }
};
