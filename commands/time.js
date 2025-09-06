import moment from 'moment-timezone';

export const time = {
  name: 'time',
  description: 'Get current time for any timezone',
  usage: '.time <Continent/City>',
  
  async execute(msg, args, { sock, m, config, getClosestTimezone }) {
    try {  
      if (!args || args.length === 0) {  
        return msg.reply("Usage: .time <Continent/City>\nExample: .time Asia/Kolkata");  
      }  

      let tzInput = args.join(' ');  
      if (tzInput.includes(' ')) {  
        tzInput = tzInput.replace(' ', '/');  
      }  
        
      if (!moment.tz.zone(tzInput)) {  
        let suggestedTz = null;  
        const commonTimezones = {  
          'india': 'Asia/Kolkata',  
          'kolkata': 'Asia/Kolkata',  
          'mumbai': 'Asia/Kolkata',  
          'delhi': 'Asia/Kolkata',  
          'chennai': 'Asia/Kolkata',  
          'bangalore': 'Asia/Kolkata',  
          
          'usa': 'America/New_York',  
          'newyork': 'America/New_York',  
          'ny': 'America/New_York',  
          'nyc': 'America/New_York',  
          'losangeles': 'America/Los_Angeles',  
          'la': 'America/Los_Angeles',  
          'chicago': 'America/Chicago',  
         
          'london': 'Europe/London',  
          'uk': 'Europe/London',  
          'britain': 'Europe/London',  
          'england': 'Europe/London',  
          'paris': 'Europe/Paris',  
          'france': 'Europe/Paris',  
          'berlin': 'Europe/Berlin',  
          'germany': 'Europe/Berlin',  
            
          'dubai': 'Asia/Dubai',  
          'uae': 'Asia/Dubai',  
          'singapore': 'Asia/Singapore',  
          'sydney': 'Australia/Sydney',  
          'tokyo': 'Asia/Tokyo',  
          'japan': 'Asia/Tokyo',  
          'seoul': 'Asia/Seoul',  
          'korea': 'Asia/Seoul',  
          'beijing': 'Asia/Shanghai',  
          'china': 'Asia/Shanghai',  
          'shanghai': 'Asia/Shanghai',  
        
        };  
          
        const lowerInput = tzInput.toLowerCase();  
        if (commonTimezones[lowerInput]) {  
          suggestedTz = commonTimezones[lowerInput];  
        } else {  
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
  }
};
