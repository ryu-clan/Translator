export const tr = {
  name: 'tr',
  description: 'Translate text to any language',
  usage: '.tr <text> [target_language]',
  async execute(msg, args, { sock, m, config, tr_txt }) {
  if (!args.length) return msg.reply(`usage: ${config.prefix}tr <text> [lang]`);    
  const to = args.length > 1 ? args.pop() : 'en';    
  const text = args.join(' ');      
  const translated = await tr_txt(text, to);    
  msg.reply(`*Tr (${to}):*\n${translated}`);    

  }
};
