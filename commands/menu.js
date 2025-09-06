export const menu = {
  name: 'menu',
  description: 'Show available commands',
  usage: '.menu [--fun]',
  
  async execute(msg, args, { sock, m, config }) {
    if (args.includes('--fun')) {
      msg.reply(`--------[ ♧ Eternity Fun ♧ ]---------
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

      msg.reply(`--------[ ♧ Eternity ♧ ]---------
> .ping  ~ Latency Check
> .alive ~ Bot Status
> .menu --fun ~ Fun Commands
> .define ~ Urban Dictionary lookup
> .weather ~ Weather information
------------------------------------
ETERNITY | THE BEST IS YET TO BE
------------------------------------`);
    }
  }
};
