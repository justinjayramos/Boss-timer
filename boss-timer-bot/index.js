const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const PREFIX = "!";
const BOSSES_FILE = "./bosses.json";

/* =======================
   FILE HELPERS
======================= */

function loadBosses() {
  if (!fs.existsSync(BOSSES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(BOSSES_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveBosses(data) {
  fs.writeFileSync(BOSSES_FILE, JSON.stringify(data, null, 2));
}

/* =======================
   TIME HELPERS
======================= */

function parseIntervalToMinutes(input) {
  if (!input) return null;

  if (/^\d+$/.test(input)) {
    return Number(input);
  }

  let minutes = 0;
  const h = input.match(/(\d+)\s*h/i);
  const m = input.match(/(\d+)\s*m/i);

  if (h) minutes += Number(h[1]) * 60;
  if (m) minutes += Number(m[1]);

  return minutes > 0 ? minutes : null;
}

function getNextSpawnTimestamp(boss) {
  const now = Date.now();

  if (boss.type === "interval") {
    if (!boss.lastKilled || !boss.intervalMinutes) return null;
    return boss.lastKilled + boss.intervalMinutes * 60000;
  }

  if (boss.type === "fixed") {
    const upcoming = boss.fixedSpawns
      .map(s => s.next)
      .filter(t => typeof t === "number" && t > now);

    return upcoming.length ? Math.min(...upcoming) : null;
  }

  return null;
}

function format12h(ts) {
  return new Date(ts).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function parseFixedSpawns(input) {
  const days = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6
  };

  return input.split(",").map(part => {
    const match = part.trim().match(
      /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2}):(\d{2})\s*(am|pm)/i
    );
    if (!match) return null;

    let [, day, h, m, ap] = match;
    h = parseInt(h);
    m = parseInt(m);

    if (ap.toLowerCase() === "pm" && h !== 12) h += 12;
    if (ap.toLowerCase() === "am" && h === 12) h = 0;

    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);

    let diff = days[day.toLowerCase()] - target.getDay();
    if (diff < 0 || (diff === 0 && target <= now)) diff += 7;
    target.setDate(target.getDate() + diff);

    return {
      day: day.charAt(0).toUpperCase() + day.slice(1),
      time: `${match[2]}:${match[3]} ${match[4].toUpperCase()}`,
      next: target.getTime()
    };
  }).filter(Boolean);
}

/* =======================
   READY
======================= */

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

/* =======================
   COMMAND HANDLER
======================= */

client.on("messageCreate", message => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const bosses = loadBosses();

  /* !commands */
  if (command === "commands") {
    return message.reply(
      "**📜 Boss Timer Commands**\n\n" +
      "`!addboss <name> <time>` — Interval boss (30m, 2h, 1h30m)\n" +
      "`!addboss <name> fixed <schedule>` — Fixed-day boss\n" +
      "`!killed <name> [HH:MM]` — Mark boss killed\n" +
      "`!bosses` — Show upcoming bosses\n" +
      "`!clearbosses confirm` — Clear bosses\n" +
      "`!clearalldata confirm` — Clear ALL data"
    );
  }

  /* !addboss */
  if (command === "addboss") {
    const name = args.shift();
    if (!name) return message.reply("❌ Boss name required.");

    if (args[0] === "fixed") {
      const fixedSpawns = parseFixedSpawns(args.slice(1).join(" "));
      if (!fixedSpawns.length)
        return message.reply("❌ Invalid fixed-day format.");

      bosses[name] = { type: "fixed", fixedSpawns };
      saveBosses(bosses);
      return message.reply(`✅ Fixed boss **${name}** added.`);
    }

    const interval = parseIntervalToMinutes(args[0]);
    if (!interval)
      return message.reply("❌ Invalid interval. Examples: 30m, 2h, 1h30m");

    bosses[name] = {
      type: "interval",
      intervalMinutes: interval,
      lastKilled: null
    };

    saveBosses(bosses);
    return message.reply(`✅ Interval boss **${name}** added.`);
  }

  /* !killed */
  if (command === "killed") {
    const name = args[0];
    if (!name || !bosses[name])
      return message.reply("❌ Boss not found.");

    const boss = bosses[name];
    let time = new Date();

    if (args[1]) {
      const [h, m] = args[1].split(":").map(Number);
      if (isNaN(h) || isNaN(m))
        return message.reply("❌ Use HH:MM (24h)");

      time.setHours(h, m, 0, 0);
    }

    if (boss.type === "interval") {
      boss.lastKilled = time.getTime();
    }

    saveBosses(bosses);
    return message.reply(`☠️ **${name}** marked killed.`);
  }

  /* !bosses */
  if (command === "bosses") {
    if (!Object.keys(bosses).length)
      return message.reply("❌ No bosses added.");

    const sorted = Object.entries(bosses)
      .map(([name, boss]) => ({
        name,
        boss,
        next: getNextSpawnTimestamp(boss)
      }))
      .sort((a, b) => {
        if (a.next === null) return 1;
        if (b.next === null) return -1;
        return a.next - b.next;
      });

    let msg = "**🗓 Boss Spawn Timers (Soonest First)**\n\n";

    for (const { name, boss, next } of sorted) {
      if (boss.type === "fixed") {
        msg += `**${name}**\n📅 ${boss.fixedSpawns.map(s => `${s.day} ${s.time}`).join(", ")}\n\n`;
      } else if (!next) {
        msg += `**${name}**\n⏳ No kill recorded yet\n\n`;
      } else {
        const mins = Math.ceil((next - Date.now()) / 60000);
        msg += `**${name}**\n⏰ Next spawn: ${format12h(next)} (${mins} min)\n\n`;
      }
    }

    return message.reply(msg);
  }

  /* !clearbosses */
  if (command === "clearbosses") {
    if (args[0] !== "confirm")
      return message.reply("⚠️ Use `!clearbosses confirm`");

    saveBosses({});
    return message.reply("🧹 Boss timers cleared.");
  }

  /* !clearalldata */
  if (command === "clearalldata") {
    if (args[0] !== "confirm")
      return message.reply("⚠️ Use `!clearalldata confirm`");

    saveBosses({});
    return message.reply("🧹 ALL boss data cleared.");
  }
});

/* =======================
   LOGIN
======================= */

client.login(process.env.DISCORD_TOKEN);
