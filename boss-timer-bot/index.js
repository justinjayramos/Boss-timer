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
  return new Date();
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
    boss.lastKilled = nowPH().getTime();

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
          return {
            name,
            next,
            text: `${format12h(next)} (${minutesToText(Math.ceil((next - now) / 60000))})`
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => a.next - b.next);

    if (!list.length) return message.reply("⚠️ No active boss timers.");

    return message.reply(
      "**📜 Boss Timers (Soonest First)**\n\n" +
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
      "`!killed <name>` – Mark boss killed\n" +
      "`!bosses` – Show next spawns (sorted)\n" +
      "`!clearbosses` – Clear all boss data\n"
    );
  }
});

/* =======================
   LOGIN
======================= */

client.login(process.env.DISCORD_TOKEN);
