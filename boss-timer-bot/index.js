const fs = require("fs");
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const BOSSES_FILE = "./bosses.json";
const PREFIX = "!";

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

function getNextSpawnTimestamp(boss) {
  const now = Date.now();

  // Interval boss
  if (boss.type === "interval") {
    if (!boss.lastKilled || !boss.intervalMinutes) return null;
    return boss.lastKilled + boss.intervalMinutes * 60000;
  }

  // Fixed-day boss
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
  // Example:
  // monday 11:30 am, thursday 7:00 pm
  const daysMap = {
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

    const dayIndex = daysMap[day.toLowerCase()];
    let diff = dayIndex - target.getDay();
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
   BOT READY
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

  /* ===== !commands ===== */
  if (command === "commands") {
    return message.reply(
      "**📜 Boss Timer Commands**\n\n" +
      "`!addboss <name> <minutes>` — Interval boss\n" +
      "`!addboss <name> fixed <schedule>` — Fixed-day boss\n" +
      "Example: `!addboss Livera fixed monday 11:30 am, thursday 7:00 pm`\n\n" +
      "`!killed <name> [HH:MM]` — Mark boss killed\n" +
      "`!bosses` — Show upcoming bosses\n" +
      "`!clearbosses confirm` — Delete ALL bosses"
    );
  }

  /* ===== !addboss ===== */
  if (command === "addboss") {
    const name = args.shift();
    if (!name) return message.reply("❌ Boss name required.");

    if (args[0] === "fixed") {
      const spawnText = args.slice(1).join(" ");
      const fixedSpawns = parseFixedSpawns(spawnText);

      if (!fixedSpawns.length)
        return message.reply("❌ Invalid fixed-day format.");

      bosses[name] = {
        type: "fixed",
        fixedSpawns
      };

      saveBosses(bosses);
      return message.reply(`✅ Fixed boss **${name}** added.`);
    }

    const interval = Number(args[0]);
    if (!interval)
      return message.reply("❌ Provide interval minutes.");

    bosses[name] = {
      type: "interval",
      intervalMinutes: interval,
      lastKilled: null
    };

    saveBosses(bosses);
    return message.reply(`✅ Interval boss **${name}** added.`);
  }

  /* ===== !killed ===== */
  if (command === "killed") {
    const name = args[0];
    if (!name || !bosses[name])
      return message.reply("❌ Boss not found.");

    const boss = bosses[name];
    let killedAt = new Date();

    if (args[1]) {
      const [h, m] = args[1].split(":").map(Number);
      if (isNaN(h) || isNaN(m))
        return message.reply("❌ Use HH:MM (24h)");

      killedAt.setHours(h, m, 0, 0);
    }

    if (boss.type === "interval") {
      boss.lastKilled = killedAt.getTime();
    }

    saveBosses(bosses);
    return message.reply(`☠️ **${name}** marked killed.`);
  }

  /* ===== !bosses ===== */
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
        const schedule = boss.fixedSpawns
          .map(s => `${s.day} ${s.time}`)
          .join(", ");

        msg += `**${name}**\n📅 ${schedule}\n\n`;
      } else if (!next) {
        msg += `**${name}**\n⏳ No kill recorded yet\n\n`;
      } else {
        const mins = Math.ceil((next - Date.now()) / 60000);
        msg += `**${name}**\n⏰ Next spawn: ${format12h(next)} (${mins} min)\n\n`;
      }
    }

    return message.reply(msg);
  }

  /* ===== !clearbosses ===== */
  if (command === "clearbosses") {
    if (args[0] !== "confirm")
      return message.reply("⚠️ Use `!clearbosses confirm`");

    saveBosses({});
    return message.reply("🧹 All bosses cleared.");
  }
});


client.login(process.env.DISCORD_TOKEN);
