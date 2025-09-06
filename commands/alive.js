export const alive = {
  name: 'alive',
  description: 'Check if bot is alive and running',
  usage: '.alive',
  
  async execute(msg, args, { sock, m, config }) {    
    const username = msg?.pushName ||     
                     msg?.key?.participant?.split('@')[0] ||     
                     msg?.key?.remoteJid?.split('@')[0] ||     
                     "User";    
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
       
    const intro = intros[Math.floor(Math.random() * intros.length)];    
    const core = cores[Math.floor(Math.random() * cores.length)];    
    const fn = `${intro}, ${username}! ${core}.`;    
    await msg.reply(fn);
  }
};
