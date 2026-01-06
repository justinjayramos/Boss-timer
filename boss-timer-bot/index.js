const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const PREFIX = "!";
const DATA_FILE = "./bosses.json";
const TIMEZONE = "Asia/Manila";

/* =======================
   UTILITIES
======================= */

function loadBosses() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    if (!data.trim()) return {};
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveBosses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nowPH() {
  return new Date(); // Store in UTC, display in PH time
}

function format12h(ts) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function minutesToText(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function parseIntervalToMinutes(input) {
  if (!input) return null;
  if (/^\d+$/.test(input)) return Number(input);

  let mins = 0;
  const h = input.match(/(\d+)h/i);
  const m = input.match(/(\d+)m/i);

  if (h) mins += Number(h[1]) * 60;
  if (m) mins += Number(m[1]);

  return mins > 0 ? mins : null;
}

function parseTimeInput(timeStr) {
  // Parse time in format "14:34" or "2:34pm" or "2:34 pm"
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const meridiem = match[3]?.toLowerCase();

  // Validate minutes
  if (minutes < 0 || minutes > 59) return null;

  // Handle 12-hour format
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else {
    // 24-hour format
    if (hours < 0 || hours > 23) return null;
  }

  // Get current date in Philippine timezone
  const now = new Date();
  const phDateString = now.toLocaleString("en-US", { 
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false
  });
  
  const [month, day, year] = phDateString.split(', ')[0].split('/');
  
  // Create date with specified time in Philippine timezone
  // We need to construct the ISO string for the PH timezone
  const phDate = new Date(`${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+08:00`);
  
  return phDate.getTime();
}

/* =======================
   BOT
======================= */

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const bosses = loadBosses();

  /* ---------- !addboss ---------- */
  if (command === "addboss") {
    const name = args.shift()?.toLowerCase();
    if (!name) return message.reply("❌ Usage: `!addboss <name> <interval>`");

    const interval = parseIntervalToMinutes(args.join(""));
    if (!interval) {
      return message.reply("❌ Invalid interval. Examples: `10h`, `30m`, `1h30m`, `90`");
    }

    bosses[name] = {
      type: "interval",
      interval,
      lastKilled: null
    };

    saveBosses(bosses);
    return message.reply(`✅ Boss **${name}** added (${minutesToText(interval)})`);
  }

  /* ---------- !killed ---------- */
  if (command === "killed") {
    const name = args.shift()?.toLowerCase();
    if (!name || !bosses[name]) return message.reply("❌ Boss not found.");

    const boss = bosses[name];
    
    // Check if time is provided
    const timeStr = args[0];
    let killTime;
    
    if (timeStr) {
      killTime = parseTimeInput(timeStr);
      if (!killTime) {
        return message.reply("❌ Invalid time format. Use `14:34` (24h) or `2:34pm` (12h)");
      }
    } else {
      killTime = nowPH().getTime();
    }
    
    boss.lastKilled = killTime;

    saveBosses(bosses);
    return message.reply(`☠️ **${name}** marked killed at ${format12h(boss.lastKilled)}`);
  }

  /* ---------- !bosses ---------- */
  if (command === "bosses") {
    const now = nowPH().getTime();

    const list = Object.entries(bosses)
      .map(([name, boss]) => {
        if (boss.type === "interval" && boss.lastKilled) {
          const next = boss.lastKilled + boss.interval * 60000;
          const timeUntil = Math.ceil((next - now) / 60000);
          return {
            name,
            next,
            text: `${format12h(next)} (${timeUntil > 0 ? minutesToText(timeUntil) : 'Ready!'})`
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.next - b.next);

    if (!list.length) return message.reply("⚠️ No active boss timers.");

    return message.reply(
      "**📜 Boss Timers**\n\n" +
      list.map(b => `**${b.name}** → ${b.text}`).join("\n")
    );
  }

  /* ---------- !clearbosses ---------- */
  if (command === "clearbosses") {
    saveBosses({});
    return message.reply("🧹 All boss data cleared.");
  }

  /* ---------- !commands ---------- */
  if (command === "commands") {
    return message.reply(
      "**📖 Boss Timer Commands**\n" +
      "`!addboss <name> <interval>` – Add interval boss (10h, 30m)\n" +
      "`!killed <name>` – Mark boss killed now\n" +
      "`!killed <name> <time>` – Mark boss killed at time (14:34 or 2:34pm)\n" +
      "`!bosses` – Show next spawns (sorted)\n" +
      "`!clearbosses` – Clear all boss data\n"
    );
  }
});

/* =======================
   LOGIN
======================= */

client.login(process.env.DISCORD_TOKEN);
