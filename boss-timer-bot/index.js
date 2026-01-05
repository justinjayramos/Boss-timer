const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

const DATA_FILE = "./bosses.json";
const DEFAULT_ALERT_MINUTES = parseInt(process.env.DEFAULT_ALERT_MINUTES || "10");
const PING_ROLE_ID = process.env.PING_ROLE_ID;

const DAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

/* ------------------ FILE HELPERS ------------------ */
function loadBosses() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const data = fs.readFileSync(DATA_FILE, "utf8");
    if (!data.trim()) return {};
    return JSON.parse(data);
  } catch {
    fs.writeFileSync(DATA_FILE, "{}");
    return {};
  }
}

function saveBosses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ------------------ FIXED SPAWN HELPERS ------------------ */
function parseFlexibleFixedSpawns(spawnStr) {
  const parts = spawnStr.split(/[\s,]+/);
  const spawns = [];

  for (let i = 0; i < parts.length - 1; i++) {
    const day = DAYS[parts[i].toLowerCase()];
    if (day === undefined) continue;

    const [hour, minute] = (parts[i + 1] || "").split(":").map(Number);
    if (isNaN(hour) || isNaN(minute)) continue;

    spawns.push({ day, hour, minute });
    i++;
  }

  return spawns;
}

function nextFixedSpawn(fixedSpawns) {
  const now = new Date();

  return fixedSpawns
    .map(s => {
      const d = new Date(now);
      d.setHours(s.hour, s.minute, 0, 0);
      const diff = (s.day - d.getDay() + 7) % 7;
      if (diff === 0 && d < now) d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + diff);
      return d;
    })
    .sort((a, b) => a - b)[0];
}

function formatFixedSpawns(fixedSpawns) {
  return fixedSpawns.map(s => {
    const dayName = Object.keys(DAYS).find(k => DAYS[k] === s.day);
    let hour = s.hour;
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${hour}:${String(s.minute).padStart(2, "0")} ${ampm}`;
  }).join(", ");
}

/* ------------------ READY ------------------ */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  setInterval(() => {
    const bosses = loadBosses();
    const now = new Date();

    for (const [name, data] of Object.entries(bosses)) {

      // Interval boss alerts
      if (data.interval && data.lastKilled) {
        const next = new Date(data.lastKilled + data.interval);
        const alertTime = new Date(next.getTime() - data.alertMinutes * 60000);

        if (now >= alertTime && now < next && !data.alerted) {
          const channel = client.channels.cache.find(c => c.isTextBased());
          channel?.send(`⏰ <@&${PING_ROLE_ID}> **${name}** spawning in **${data.alertMinutes} min**`);
          data.alerted = true;
          saveBosses(bosses);
        }
      }

      // Fixed-day alerts
      if (data.fixedSpawns) {
        const next = nextFixedSpawn(data.fixedSpawns);
        const alertTime = new Date(next.getTime() - data.alertMinutes * 60000);

        if (now >= alertTime && now < next && data.lastNotified !== next.getTime()) {
          const channel = client.channels.cache.find(c => c.isTextBased());
          channel?.send(
            `⏰ <@&${PING_ROLE_ID}> **${name}** spawning at **${next.toLocaleString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true
            })}**`
          );
          data.lastNotified = next.getTime();
          saveBosses(bosses);
        }
      }
    }
  }, 60000);
});

/* ------------------ COMMANDS ------------------ */
client.on("messageCreate", async message => {
  if (message.author.bot || !message.content.startsWith("!")) return;

  const args = message.content.slice(1).split(" ");
  const command = args.shift().toLowerCase();
  const bosses = loadBosses();

  /* !commands */
  if (command === "commands") {
    return message.reply(
      "**📖 Boss Timer Commands**\n" +
      "`!addboss <boss> <interval | DAY HH:MM ...> [alert]`\n" +
      "`!killed <boss> [HH:MM]`\n" +
      "`!setalert <boss> <minutes>`\n" +
      "`!bosses`"
    );
  }

  /* !addboss */
  if (command === "addboss") {
    const name = args.shift();
    if (!name || args.length < 1)
      return message.reply("Usage: !addboss <boss> <interval | DAY HH:MM ...> [alert]");

    let alertMinutes = DEFAULT_ALERT_MINUTES;
    if (!isNaN(args[args.length - 1])) alertMinutes = parseInt(args.pop());

    const spawnStr = args.join(" ");

    if (spawnStr.endsWith("h") || spawnStr.endsWith("m")) {
      const interval = spawnStr.endsWith("h")
        ? parseInt(spawnStr) * 3600000
        : parseInt(spawnStr) * 60000;

      bosses[name] = { interval, lastKilled: null, alertMinutes, alerted: false };
      saveBosses(bosses);
      return message.reply(`✅ **${name}** added (interval ${spawnStr})`);
    }

    const fixedSpawns = parseFlexibleFixedSpawns(spawnStr);
    if (!fixedSpawns.length)
      return message.reply("Invalid format. Example: Monday 11:30 Thursday 19:00");

    bosses[name] = { fixedSpawns, alertMinutes, lastNotified: null };
    saveBosses(bosses);
    return message.reply(`✅ **${name}** added (fixed-day boss)`);
  }

  /* !killed */
  if (command === "killed") {
    const name = args[0];
    if (!bosses[name]) return message.reply("Boss not found.");

    let time = new Date();
    if (args[1]) {
      const [h, m] = args[1].split(":").map(Number);
      if (!isNaN(h) && !isNaN(m)) time.setHours(h, m, 0, 0);
    }

    if (bosses[name].interval) {
      bosses[name].lastKilled = time.getTime();
      bosses[name].alerted = false;
    } else {
      bosses[name].lastNotified = time.getTime();
    }

    saveBosses(bosses);
    return message.reply(`☠️ **${name}** marked killed.`);
  }

  /* !setalert */
  if (command === "setalert") {
    const name = args[0];
    const mins = parseInt(args[1]);
    if (!bosses[name] || isNaN(mins)) return message.reply("Invalid usage.");
    bosses[name].alertMinutes = mins;
    bosses[name].alerted = false;
    bosses[name].lastNotified = null;
    saveBosses(bosses);
    return message.reply(`🔔 Alert set to ${mins} min for **${name}**`);
  }

  /* !bosses */
  if (command === "bosses") {
    if (!Object.keys(bosses).length) return message.reply("No bosses tracked.");

    let reply = "**📋 Boss Timers**\n";
    const now = new Date();

    for (const [name, data] of Object.entries(bosses)) {
      if (data.interval && data.lastKilled) {
        const next = new Date(data.lastKilled + data.interval);
        reply += `• **${name}** — Next: ${next.toLocaleString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        })}\n`;
      } else if (data.fixedSpawns) {
        const next = nextFixedSpawn(data.fixedSpawns);
        reply += `• **${name}** — Spawns: ${formatFixedSpawns(data.fixedSpawns)} | Next: ${next.toLocaleString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        })}\n`;
      }
    }

    message.reply(reply);
  }
});

client.login(process.env.DISCORD_TOKEN);
