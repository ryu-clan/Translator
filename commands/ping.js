export const ping = {
  name: 'ping',
  description: 'Check bot latency',
  usage: '.ping',
  async execute(msg, args, { sock, m, config }) {
    const start = Date.now();    
    await msg.reply(` ㅤㅤㅤ`);    
    const end = Date.now();    
    msg.reply(` 🎃 speed: ${end - start}ms`);
  }
};
