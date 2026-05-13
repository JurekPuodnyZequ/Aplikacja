require('dotenv').config();

const legitCheckMap = new Map();
const statusLinkCache = new Map(); 
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const app = express();

const {
  CLIENT_ID,
  CLIENT_SECRET,
  BOT_TOKEN,
  REDIRECT_URI,
  GUILD_ID,
  ROLE_ID,
  PORT = 3000
} = process.env;

const LOG_CHANNEL_ID         = '1495432512506429465';
const WELCOME_CHANNEL_ID     = '1495432511893803063';
const KALKULATOR_CHANNEL_ID  = '1498340002323628164';
const KALKULATOR_MSG_KEY     = 'kalkulator_message_id';
const TRANSFER_ROLE_ID       = '1495432509263974431';

const CENNIK_CHANNEL_ID      = '1499896166911840323';
const CENNIK_MSG_KEY         = 'cennik_message_id';
const TICKET_CATEGORY_ID     = '1495432511893803060';
const TICKET_LOG_CHANNEL_ID  = '1495432512506429465';
const LEGIT_CHECK_CHANNEL_ID = '1495432512175083607';

const METODY_CHANNEL_ID      = '1495432511893803068';
const METODY_MSG_KEY         = 'metody_message_id';

const STAFF_BASE_ROLE_ID     = '1495432509263974438';
const SS_SHOP_EMOJI_URL      = 'https://cdn.discordapp.com/emojis/1499432018252140694.webp?size=96';

// ─── DROP SYSTEM ───────────────────────────────────────────────────────────────
const DROP_CHANNEL_ID    = '1501965406431219992';
const DROP_REQUIRED_ROLE = '1501968954627854528';
const DROP_COOLDOWN_MS   = 2 * 60 * 60 * 1000;

// ─── AUTO-ROLA ZA STATUS ──────────────────────────────────────────────────────
const AUTO_ROLE_ID         = '1501968954627854528';
const REQUIRED_STATUS_LINK = '.gg/yKPpzUSFpg';

// ─── DICE / TOKEN SYSTEM ──────────────────────────────────────────────────────
const DICE_CHANNEL_ID      = '1502342301433729084';
const DICE_REQUIRED_ROLE   = '1502332174723190957';
const DICE_OWNER_ID        = '1215343846003576872';

const TOKEN_VALUE = 30000; // 1 token = 30k dolarów serwerowych

// Mapa aktywnych wygranych (userId -> { wygrana, timestamp })
const activeWins = new Map();

// ─── NAGRODY ──────────────────────────────────────────────────────────────────
const DROP_NAGRODY = [
  { nazwa: '-2.5% zniżki w SSshop',    emoji: '🏷️', szansa: 3.68 },
  { nazwa: '-5% zniżki w SSshop',      emoji: '🏷️', szansa: 1.472 },
  { nazwa: '-10% zniżki w SSshop',     emoji: '🏷️', szansa: 0.10 },
  { nazwa: '5k Anarchia',              emoji: '💰', szansa: 1.84 },
  { nazwa: '8k Anarchia LF',           emoji: '💰', szansa: 0.50 },
  { nazwa: '15k Anarchia LF',          emoji: '💰', szansa: 0.10 },
  { nazwa: '1zł do wydania na SSshop', emoji: '💵', szansa: 1.472 },
  { nazwa: '2zł do wydania na SSshop', emoji: '💵', szansa: 0.736 },
  { nazwa: '3zł do wydania na SSshop', emoji: '💵', szansa: 0.10 },
];

function losujNagrode() {
  const roll = Math.random() * 100;
  let current = 0;
  for (const nagroda of DROP_NAGRODY) {
    current += nagroda.szansa;
    if (roll <= current) return nagroda;
  }
  return null;
}

function formatCooldown(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

// ─── STATUS CHECK ─────────────────────────────────────────────────────────────
function memberHasStatusLink(member) {
  try {
    const presence = member.presence;
    if (!presence || presence.status === 'offline' || presence.status === 'invisible') {
      return statusLinkCache.get(member.id) ?? false;
    }
    for (const activity of presence.activities) {
      if (activity.type === 4) {
        const state = activity.state || '';
        if (state.includes(REQUIRED_STATUS_LINK)) {
          statusLinkCache.set(member.id, true);
          return true;
        }
      }
    }
    statusLinkCache.set(member.id, false);
    return false;
  } catch {
    return statusLinkCache.get(member.id) ?? false;
  }
}

// ─── AUTO ROLE ────────────────────────────────────────────────────────────────
async function checkAndUpdateAutoRole(member) {
  try {
    if (!member || member.user.bot) return;

    const presence = member.presence;
    const isOfflineOrInvisible =
      !presence ||
      presence.status === 'offline' ||
      presence.status === 'invisible';

    if (isOfflineOrInvisible) return;

    const hasStatusLink  = memberHasStatusLink(member);
    const hasRole        = member.roles.cache.has(AUTO_ROLE_ID);

    if (hasStatusLink && !hasRole) {
      await member.roles.add(AUTO_ROLE_ID);
      console.log(`✅ Auto-rola NADANA: ${member.user.tag}`);
    } else if (!hasStatusLink && hasRole) {
      await member.roles.remove(AUTO_ROLE_ID);
      console.log(`❌ Auto-rola USUNIĘTA: ${member.user.tag}`);
    }

  } catch (err) {
    console.error(`❌ Błąd auto-roli ${member?.user?.tag}:`, err);
  }
}

// ─── DROP LOG ─────────────────────────────────────────────────────────────────
async function logDropResult(interaction, nagroda) {
  try {
    const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor(nagroda ? 0x6a00ff : 0x2B2D31)
      .setTitle(nagroda ? '🎁 Drop — nagroda wylosowana!' : '🎁 Drop — brak nagrody')
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        {
          name: '👤 Użytkownik',
          value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`,
          inline: true
        },
        { name: '🆔 ID',  value: `\`${interaction.user.id}\``, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        {
          name: '🎉 Nagroda',
          value: nagroda ? `${nagroda.emoji} **${nagroda.nazwa}**` : '❌ Nic nie wylosowano',
          inline: false
        },
        {
          name: '🕐 Czas',
          value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
          inline: false
        }
      )
      .setFooter({ text: 'SS Shop | Drop System', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Błąd logDropResult:', err.message);
  }
}

// ─── METODY PŁATNOŚCI DLA TICKETÓW ───────────────────────────────────────────
const TICKET_METODY = {
  blik_telefon: { nazwa: 'BLIK na numer tel.',               prowizja: 0,  emoji: '📱' },
  crypto:       { nazwa: 'Crypto (BTC/ETH/LTC/USDT/USDC)',   prowizja: 0,  emoji: '🪙' },
  paypal:       { nazwa: 'PayPal',                            prowizja: 5,  emoji: '<:paypal:1498357795433746653>' },
  psc:          { nazwa: 'PSC',                               prowizja: 10, emoji: '<:psc:1498356914013339705>' },
};

function obliczCeneZProwizja(cenaBaza, prowizjaProcent) {
  if (!cenaBaza || cenaBaza === null) return null;
  const prowizja = cenaBaza * (prowizjaProcent / 100);
  return +(cenaBaza + prowizja).toFixed(2);
}

function buildMetodyTicketuRow(pelerynkaKey) {
  const options = Object.entries(TICKET_METODY).map(([value, data]) => {
    const label = data.prowizja > 0
      ? `${data.nazwa} (+${data.prowizja}% prowizji)`
      : `${data.nazwa} (bez prowizji)`;
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(value);
    if (data.emoji.startsWith('<')) {
      const id = data.emoji.match(/\d{17,20}/)?.[0];
      if (id) opt.setEmoji({ id });
    } else {
      opt.setEmoji({ name: data.emoji });
    }
    return opt;
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`select_metoda_platnosci_${pelerynkaKey}`)
    .setPlaceholder('💳 Wybierz metodę płatności...')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

// ─── PELERYNKI ────────────────────────────────────────────────────────────────
const PELERYNKI = {
  'home cape':    { cena: 7,    emoji: '<:HOME:1499901372974497973>',          nazwaDisplay: 'Home Cape'    },
  'copper cape':  { cena: 10,   emoji: '<:COPPER:1499901582274330675>',        nazwaDisplay: 'Copper Cape'  },
  'menace':       { cena: 10,   emoji: '<:MENACE:1499901418646012056>',        nazwaDisplay: 'Menace'       },
  'purple heart': { cena: 18,   emoji: '<:PURPLE_HEART:1499901459796590693>',  nazwaDisplay: 'Purple Heart' },
  'mce cape':     { cena: 200,  emoji: '<:MCE:1499901525617672322>',           nazwaDisplay: 'MCE Cape'     },
  'zestaw':       { cena: null, emoji: '🎁',                                   nazwaDisplay: 'Zestaw'       },
};

function znajdzPelerynke(input) {
  const lower = input.trim().toLowerCase();
  for (const [key, data] of Object.entries(PELERYNKI)) {
    if (lower === key || lower === data.nazwaDisplay.toLowerCase()) {
      return { key, ...data };
    }
  }
  return null;
}

// ─── GIFY POWITALNE ────────────────────────────────────────────────────────────
const WELCOME_GIFS = [
  { url: 'https://media.giphy.com/media/yWku98eNsMSZOEEWnC/giphy.gif', weight: 80   },
  { url: 'https://media.giphy.com/media/EIXWGdjKzTFwEXSw66/giphy.gif', weight: 5.71 },
  { url: 'https://media.giphy.com/media/ozPaoquAeaMskUxhjM/giphy.gif', weight: 2.29 },
  { url: 'https://media.giphy.com/media/7NNqJw0T3cb62PMzXR/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/qRdGR2H9EtiXUJXorm/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/gagWe6ydNEVRZyOa9V/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/wXplZ7lC7H8WB5pFxE/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/gNbWwrrPz1G5U58OEs/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/uMVjYMOmpiHSGWgMUw/giphy.gif', weight: 1.71 },
  { url: 'https://media.giphy.com/media/Zki5ZDOoU0vUpydtDy/giphy.gif', weight: 1.71 },
];

function getRandomGif() {
  const totalWeight = WELCOME_GIFS.reduce((sum, g) => sum + g.weight, 0);
  let random = Math.random() * totalWeight;
  for (const gif of WELCOME_GIFS) {
    if (random < gif.weight) return gif.url;
    random -= gif.weight;
  }
  return WELCOME_GIFS[0].url;
}

async function sendWelcomeMessage(member) {
  try {
    const welcomeChannel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
    if (!welcomeChannel) return;
    const randomGif = getRandomGif();
    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setTitle(`💸Witaj na serwerze, **${member.user.username}**!💸`)
      .setDescription(
        `💜 Cieszymy się, że dołączyłeś do **SS Shop**! 💜\n` +
        `💜 Zweryfikuj się i sprawdź naszą ofertę pelerynek! 💜\n\n`
      )
      .setThumbnail(randomGif)
      .setFooter({ text: 'SS Shop | Witamy!', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    await welcomeChannel.send({ content: `<@${member.user.id}>`, embeds: [welcomeEmbed] });
  } catch (err) {
    console.error('❌ Błąd sendWelcomeMessage:', err.message);
  }
}

// ─── KONFIGURACJA ──────────────────────────────────────────────────────────────
const PRZELICZNIK = 67676767;

// ─── BAZA DANYCH ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:ooqqGeeYDMypYAkQVxqJTNBstkLreIzr@postgres.railway.internal:5432/railway',
  ssl: false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initDB() {
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS taken_by_user_id TEXT;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS taken_by_username TEXT;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS legit_check_msg_id TEXT;`);
  await pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS metoda_platnosci TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      username      TEXT,
      global_name   TEXT,
      avatar        TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    BIGINT,
      authorized_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_config (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      ticket_id          SERIAL PRIMARY KEY,
      channel_id         TEXT UNIQUE,
      user_id            TEXT,
      pelerynka          TEXT,
      cena               TEXT,
      metoda_platnosci   TEXT,
      status             TEXT DEFAULT 'open',
      taken_by_user_id   TEXT DEFAULT NULL,
      taken_by_username  TEXT DEFAULT NULL,
      legit_check_msg_id TEXT,
      created_at         TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS drop_data (
      user_id    TEXT PRIMARY KEY,
      last_drop  BIGINT DEFAULT 0,
      nagrody    TEXT DEFAULT '[]'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      user_id TEXT PRIMARY KEY,
      amount  INTEGER DEFAULT 0
    )
  `);

  console.log('✅ Baza danych gotowa!');
}

async function saveUser(userData) {
  await pool.query(`
    INSERT INTO users (user_id, username, global_name, avatar, access_token, refresh_token, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (user_id) DO UPDATE SET
      username      = $2,
      global_name   = $3,
      avatar        = $4,
      access_token  = $5,
      refresh_token = $6,
      expires_at    = $7,
      authorized_at = NOW()
  `, [userData.user_id, userData.username, userData.global_name, userData.avatar,
      userData.access_token, userData.refresh_token, userData.expires_at]);
}

async function getConfig(key) {
  const res = await pool.query('SELECT value FROM bot_config WHERE key = $1', [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setConfig(key, value) {
  await pool.query(`
    INSERT INTO bot_config (key, value) VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value = $2
  `, [key, value]);
}

async function getDropData(userId) {
  const res = await pool.query('SELECT * FROM drop_data WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) return { last_drop: 0, nagrody: [] };
  return { last_drop: Number(res.rows[0].last_drop), nagrody: JSON.parse(res.rows[0].nagrody) };
}

async function saveDropData(userId, lastDrop, nagrody) {
  await pool.query(`
    INSERT INTO drop_data (user_id, last_drop, nagrody)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET last_drop = $2, nagrody = $3
  `, [userId, lastDrop, JSON.stringify(nagrody)]);
}

// ─── TOKEN DB HELPERS ─────────────────────────────────────────────────────────
async function getTokens(userId) {
  const res = await pool.query('SELECT amount FROM tokens WHERE user_id = $1', [userId]);
  return res.rows.length > 0 ? res.rows[0].amount : 0;
}

async function addTokens(userId, amount) {
  await pool.query(`
    INSERT INTO tokens (user_id, amount) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET amount = tokens.amount + $2
  `, [userId, amount]);
}

async function removeTokens(userId, amount) {
  await pool.query(`
    UPDATE tokens SET amount = GREATEST(0, amount - $2) WHERE user_id = $1
  `, [userId, amount]);
}

async function setTokens(userId, amount) {
  await pool.query(`
    INSERT INTO tokens (user_id, amount) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET amount = $2
  `, [userId, amount]);
}

// ─── DICE LOGIC ───────────────────────────────────────────────────────────────
function getDiceWinChance(numer) {
  if (numer < 4) return 11;   // 1-3 → 11%
  if (numer < 7) return 4;   // 4-6 → 4%
  return 1;                  // 7-10 → 1%
}

function rollDice(wybranyNumer) {
  const szansa = getDiceWinChance(wybranyNumer);
  const roll = Math.random() * 100;
  return { wygral: roll < szansa, roll: Math.floor(roll), szansa };
}

// ─── TOKEN REFRESH ─────────────────────────────────────────────────────────────
async function refreshAccessToken(userId) {
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  if (user.expires_at > Date.now() + 600_000) return user.access_token;

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: user.refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
    );
    const newAccessToken  = tokenRes.data.access_token;
    const newRefreshToken = tokenRes.data.refresh_token;
    const expiresAt       = Date.now() + tokenRes.data.expires_in * 1000;
    await pool.query(
      `UPDATE users SET access_token=$1, refresh_token=$2, expires_at=$3 WHERE user_id=$4`,
      [newAccessToken, newRefreshToken, expiresAt, userId]
    );
    return newAccessToken;
  } catch (err) {
    console.error(`❌ Błąd odświeżenia tokenu dla ${userId}:`, err?.response?.data || err.message);
    return null;
  }
}

// ─── KALKULATOR ────────────────────────────────────────────────────────────────
const PROWIZJE = {
  blik_telefon: { nazwa: 'BLIK na numer telefonu', prowizja: 0,  emoji: '📱' },
  blik_kod:     { nazwa: 'Kod BLIK',               prowizja: 10, emoji: '<:blik:1498356421262053386>' },
  btc:          { nazwa: 'BTC (Bitcoin)',           prowizja: 0,  emoji: '<:btc:1498356295408029807>' },
  ltc:          { nazwa: 'LTC (Litecoin)',          prowizja: 0,  emoji: '<:ltc:1498356372339818747>' },
  usdt:         { nazwa: 'USDT',                   prowizja: 0,  emoji: '<:usdt:1498356339053822102>' },
  usdc:         { nazwa: 'USDC',                   prowizja: 0,  emoji: '<:usdc:1498356270498054264>' },
  eth:          { nazwa: 'ETH (Ethereum)',          prowizja: 0,  emoji: '<:eth:1498008998299959397>' },
  paypal:       { nazwa: 'PayPal',                 prowizja: 13, emoji: '<:paypal:1498357795433746653>' },
  psc_paragon:  { nazwa: 'PSC z paragonem',        prowizja: 13, emoji: '<:psc:1498356914013339705>' },
  psc_bez:      { nazwa: 'PSC bez paragonu',       prowizja: 20, emoji: '<:psc:1498356914013339705>' },
  mypsc:        { nazwa: 'MyPSC (tylko)',           prowizja: 25, emoji: '<:mypsc:1498356473153978450>' },
};

function parseZloty(input) {
  const lower = input.trim().toLowerCase();
  if (!lower.endsWith('zł') && !lower.endsWith('zl')) return null;
  const val = parseFloat(lower.replace(/zł|zl/, '').trim().replace(',', '.'));
  return isNaN(val) || val <= 0 ? null : val;
}

function parseDolary(input) {
  const trimmed = input.trim().toLowerCase().replace(',', '.');
  if (trimmed.endsWith('m')) {
    const val = parseFloat(trimmed.slice(0, -1));
    return isNaN(val) || val <= 0 ? null : val * 1_000_000;
  }
  if (trimmed.endsWith('k')) {
    const val = parseFloat(trimmed.slice(0, -1));
    return isNaN(val) || val <= 0 ? null : val * 1_000;
  }
  const val = parseFloat(trimmed);
  return isNaN(val) || val <= 0 ? null : val;
}

function formatDolary(val) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2).replace(/\.00$/, '')}m`;
  if (val >= 1_000)     return `${(val / 1_000).toFixed(2).replace(/\.00$/, '')}k`;
  return val.toLocaleString('pl-PL');
}

function buildSelectMenuRow(customId) {
  const options = Object.entries(PROWIZJE).map(([value, data]) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(`${data.nazwa} — ${data.prowizja}% prowizji`)
      .setValue(value);
    if (data.emoji.startsWith('<')) {
      const id = data.emoji.match(/\d{17,20}/)?.[0];
      if (id) opt.setEmoji({ id });
    } else {
      opt.setEmoji({ name: data.emoji });
    }
    return opt;
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('💜 Wybierz metodę płatności...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function buildKalkulatorComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('kalkulator_ile_dostane')
      .setLabel('💰 Ile dolarów serwerowych dostanę?')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('kalkulator_ile_zaplacic')
      .setLabel('💸 Ile zapłacić za tyle dolarów serwerowych?')
      .setStyle(ButtonStyle.Secondary)
  )];
}

function buildKalkulatorEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({
      name: '💜 SS Shop 💜 × Kalkulator Prowizji',
      iconURL: 'https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png'
    })
    .setThumbnail('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png')
    .setTitle('💜 Kalkulator Prowizji — SS Shop 💜')
    .setDescription(
      '>>> Jeżeli chcesz obliczyć **prowizję swojej wymiany**, kliknij odpowiedni przycisk poniżej.\n' +
      'Wybór metody płatności oraz wpisanie kwoty odbywa się w wyskakującym okienku — **nikt inny tego nie zobaczy!**\n\n' +
      '💜 Kliknij przycisk i postępuj zgodnie z instrukcjami!'
    )
    .addFields(
      { name: '💜 Kurs wymiany', value: `1 zł = **${formatDolary(PRZELICZNIK)} $**`, inline: true },
      {
        name: '💜 Dostępne metody płatności',
        value: Object.values(PROWIZJE).map(d => `${d.emoji} **${d.nazwa}** — \`${d.prowizja}%\` prowizji`).join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'SS Shop | Kalkulator Prowizji 💜' })
    .setTimestamp();
}

async function sendOrUpdateKalkulator() {
  try {
    const channel = await client.channels.fetch(KALKULATOR_CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('❌ Nie znaleziono kanału kalkulatora'); return; }
    const embed      = buildKalkulatorEmbed();
    const components = buildKalkulatorComponents();
    const existingId = await getConfig(KALKULATOR_MSG_KEY);
    if (existingId) {
      try {
        const existing = await channel.messages.fetch(existingId);
        await existing.edit({ embeds: [embed], components });
        console.log('✅ Kalkulator zaktualizowany!');
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components });
    await setConfig(KALKULATOR_MSG_KEY, msg.id);
    console.log('✅ Kalkulator wysłany!');
  } catch (err) {
    console.error('❌ Błąd kalkulatora:', err.message);
  }
}

// ─── CENNIK ────────────────────────────────────────────────────────────────────
function buildCennikEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({
      name: '💜 SS Shop 💜 × Cennik Pelerynek',
      iconURL: 'https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png'
    })
    .setThumbnail('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png')
    .setTitle('💜 Cennik Pelerynek — SS Shop 💜')
    .setDescription(
      '>>> Poniżej znajdziesz aktualny cennik pelerynek dostępnych w **SS Shop**.\n\n' +
      '**Zestawy** ustalamy indywidualnie — napisz do nas na tickecie! 🎁'
    )
    .addFields(
      {
        name: '🛒 Dostępne pelerynki',
        value:
          `<:HOME:1499901372974497973> **Home Cape** — \`7 zł\`\n` +
          `<:COPPER:1499901582274330675> **Copper Cape** — \`10 zł\`\n` +
          `<:MENACE:1499901418646012056> **Menace Cape** — \`10 zł\`\n` +
          `<:PURPLE_HEART:1499901459796590693> **Purple Heart** — \`18 zł\`\n` +
          `<:MCE:1499901525617672322> **MCE Cape** — \`200 zł\`\n`,
        inline: false
      },
      {
        name: '🎁 Zestawy',
        value: 'Zestawy pelerynek wyceniamy indywidualnie.\nStwórz ticket i podaj, jakie pelerynki Cię interesują!',
        inline: false
      },
      {
        name: '💳 Metody płatności',
        value:
          `📱 **BLIK na numer tel.** — bez prowizji\n` +
          `🪙 **Crypto** (BTC/ETH/LTC/USDT/USDC) — bez prowizji\n` +
          `<:paypal:1498357795433746653> **PayPal** — +5% prowizji\n` +
          `<:psc:1498356914013339705> **PSC** — +10% prowizji`,
        inline: false
      },
      {
        name: '🎫 Jak kupić?',
        value: 'Kliknij przycisk **🛍️ Kup pelerynkę** poniżej, aby otworzyć ticket.',
        inline: false
      }
    )
    .setFooter({ text: 'SS Shop | Cennik Pelerynek 💜' })
    .setTimestamp();
}

function buildCennikComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('kup_pelerynke')
      .setLabel('🛍️ Kup pelerynkę')
      .setStyle(ButtonStyle.Primary),
  )];
}

async function sendOrUpdateCennik() {
  try {
    const channel = await client.channels.fetch(CENNIK_CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('❌ Nie znaleziono kanału cennika'); return; }
    const embed      = buildCennikEmbed();
    const components = buildCennikComponents();
    const existingId = await getConfig(CENNIK_MSG_KEY);
    if (existingId) {
      try {
        const existing = await channel.messages.fetch(existingId);
        await existing.edit({ embeds: [embed], components });
        console.log('✅ Cennik zaktualizowany!');
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components });
    await setConfig(CENNIK_MSG_KEY, msg.id);
    console.log('✅ Cennik wysłany!');
  } catch (err) {
    console.error('❌ Błąd cennika:', err.message);
  }
}

// ─── METODY PŁATNOŚCI ──────────────────────────────────────────────────────────
function buildMetodyEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({
      name: '💜 SS Shop 💜 × Metody Płatności',
      iconURL: 'https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png'
    })
    .setThumbnail('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png')
    .setTitle('💜 Metody Płatności — SS Shop 💜')
    .setDescription(
      '>>> Poniżej znajdziesz wszystkie dostępne metody płatności w **SS Shop** wraz z prowizjami.\n\n' +
      '**Przy tworzeniu ticketa wpisz dokładną nazwę metody płatności**, np: `PSC bez paragonu`.'
    )
    .addFields({
      name: '💳 Dostępne metody płatności',
      value:
        `<:blik:1498356421262053386> **Kod BLIK** — \`10%\` prowizji\n` +
        `📱 **BLIK na numer telefonu** — \`0%\` prowizji\n` +
        `<:psc:1498356914013339705> **PSC z paragonem** — \`13%\` prowizji\n` +
        `<:psc:1498356914013339705> **PSC bez paragonu** — \`20%\` prowizji\n` +
        `<:mypsc:1498356473153978450> **MyPSC** — \`25%\` prowizji\n` +
        `<:ltc:1498356372339818747> **LTC (Litecoin)** — \`0%\` prowizji\n` +
        `<:btc:1498356295408029807> **BTC (Bitcoin)** — \`0%\` prowizji\n` +
        `<:usdt:1498356339053822102> **USDT** — \`0%\` prowizji\n` +
        `<:usdc:1498356270498054264> **USDC** — \`0%\` prowizji\n` +
        `<:eth:1498008998299959397> **ETH (Ethereum)** — \`0%\` prowizji\n` +
        `<:paypal:1498357795433746653> **PayPal** — \`13%\` prowizji\n`,
      inline: false
    })
    .setFooter({ text: 'SS Shop | Metody Płatności 💜' })
    .setTimestamp();
}

async function sendOrUpdateMetody() {
  try {
    const channel = await client.channels.fetch(METODY_CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('❌ Nie znaleziono kanału metod płatności'); return; }
    const embed      = buildMetodyEmbed();
    const existingId = await getConfig(METODY_MSG_KEY);
    if (existingId) {
      try {
        const existing = await channel.messages.fetch(existingId);
        await existing.edit({ embeds: [embed] });
        console.log('✅ Metody płatności zaktualizowane!');
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed] });
    await setConfig(METODY_MSG_KEY, msg.id);
    console.log('✅ Metody płatności wysłane!');
  } catch (err) {
    console.error('❌ Błąd metod płatności:', err.message);
  }
}

// ─── TICKET: tworzenie ────────────────────────────────────────────────────────
async function createTicketChannel(guild, user, pelerynka, cenaTekst, metodaKey) {
  const ticketName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString().slice(-4)}`;

  const existing = await pool.query(
    `SELECT channel_id FROM tickets WHERE user_id = $1 AND status = 'open'`,
    [user.id]
  );
  if (existing.rows.length > 0) {
    const existingChannelId = existing.rows[0].channel_id;
    const existingChannel = await guild.channels.fetch(existingChannelId).catch(() => null);
    if (existingChannel) return { exists: true, channelId: existingChannelId };
    await pool.query(`DELETE FROM tickets WHERE channel_id = $1`, [existingChannelId]);
  }

  const baseRole = guild.roles.cache.get(STAFF_BASE_ROLE_ID);
  const basePosition = baseRole ? baseRole.position : 0;
  const staffRoles = guild.roles.cache.filter(r => r.position >= basePosition && r.id !== guild.id);

  const permissionOverwrites = [
    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    ...staffRoles.map(role => ({
      id: role.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    })),
  ];

  let channelOptions = {
    name: ticketName,
    type: ChannelType.GuildText,
    permissionOverwrites,
    topic: `Otwarty ticket | ${user.tag} | ${pelerynka} | ${cenaTekst}`,
  };

  try {
    const cat = await guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);
    if (cat && cat.type === ChannelType.GuildCategory) channelOptions.parent = TICKET_CATEGORY_ID;
  } catch {}

  const ticketChannel = await guild.channels.create(channelOptions);
  await pool.query(
    `INSERT INTO tickets (channel_id, user_id, pelerynka, cena, metoda_platnosci, status) VALUES ($1,$2,$3,$4,$5,'open')`,
    [ticketChannel.id, user.id, pelerynka, cenaTekst, metodaKey]
  );

  return { exists: false, channel: ticketChannel };
}

// ─── TICKET: wiadomość powitalna ──────────────────────────────────────────────
async function sendTicketWelcome(ticketChannel, user, pelerynkaNazwa, cenaTekst, metodaKey) {
  const metoda = TICKET_METODY[metodaKey];
  const metodaNazwa = metoda ? `${metoda.emoji} ${metoda.nazwa}` : 'nieznana';

  const embed = new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({
      name: '💜 SS Shop 💜 × Nowy Ticket',
      iconURL: 'https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png'
    })
    .setTitle("🛍️ Twój ticket został otwarty")
    .setDescription(
      `Witaj <@${user.id}>! 💜\n\n` +
      `Dziękujemy za zainteresowanie naszą ofertą. Twój ticket został pomyślnie utworzony.\n\n` +
      `**Szczegóły zgłoszenia:**\n` +
      `> 🛒 Pelerynka: **${pelerynkaNazwa}**\n` +
      `> 💵 Cena: **${cenaTekst}**\n` +
      `> 💳 Metoda płatności: **${metodaNazwa}**\n\n` +
      `Proszę cierpliwie czekać, członek naszej obsługi zaraz się Tobą zajmie! 💜`
    )
    .setFooter({ text: 'SS Shop | System Ticketów 💜' })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("przejmij_ticket")
      .setLabel("🤝 Przejmij")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("zamknij_ticket")
      .setLabel("🔒 Zamknij Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await ticketChannel.send({ content: `<@${user.id}>`, embeds: [embed], components: [actionRow] });
}

// ─── TICKET: zamknięcie ───────────────────────────────────────────────────────
async function closeTicket(ticketChannel, closedBy) {
  try {
    const messages = await ticketChannel.messages.fetch({ limit: 100 });
    const sorted   = [...messages.values()].reverse();

    const transcript = sorted.map(m => {
      const time    = new Date(m.createdTimestamp).toLocaleString('pl-PL');
      const content = m.content || (m.embeds.length > 0 ? '[Embed]' : '[Brak treści]');
      return `[${time}] ${m.author.tag}: ${content}`;
    }).join('\n');

    const ticketData = await pool.query(
      `SELECT * FROM tickets WHERE channel_id = $1`,
      [ticketChannel.id]
    );
    const ticket = ticketData.rows[0] || {};

    legitCheckMap.delete(ticketChannel.id);

    try {
      const logChannel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID);
      if (logChannel) {
        const metodaInfo = ticket.metoda_platnosci ? (TICKET_METODY[ticket.metoda_platnosci]?.nazwa || ticket.metoda_platnosci) : 'nieznana';
        const logEmbed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🔒 Ticket zamknięty — Transcript')
          .addFields(
            { name: '👤 Użytkownik',      value: ticket.user_id ? `<@${ticket.user_id}>` : 'nieznany', inline: true },
            { name: '🛒 Pelerynka',        value: ticket.pelerynka || 'nieznana',                       inline: true },
            { name: '💵 Cena',             value: ticket.cena || 'nieznana',                            inline: true },
            { name: '💳 Metoda płatności', value: metodaInfo,                                           inline: true },
            { name: '🔒 Zamknął',          value: closedBy?.tag || closedBy?.username || 'nieznany',    inline: true },
            { name: '📅 Data',             value: `<t:${Math.floor(Date.now() / 1000)}:F>`,             inline: true }
          )
          .setFooter({ text: 'SS Shop | System Ticketów 💜' })
          .setTimestamp();

        const transcriptBuffer = Buffer.from(transcript || '(brak wiadomości)', 'utf-8');
        await logChannel.send({
          embeds: [logEmbed],
          files: [{ attachment: transcriptBuffer, name: `transcript-${ticketChannel.name}.txt` }]
        });
      }
    } catch (logErr) {
      console.error('❌ Błąd wysyłania transcriptu na logi:', logErr.message);
    }

    await pool.query(`UPDATE tickets SET status = 'closed' WHERE channel_id = $1`, [ticketChannel.id]);
    await ticketChannel.send('🔒 **Ticket zostanie zamknięty za 5 sekund...**');
    await new Promise(r => setTimeout(r, 5000));
    await ticketChannel.delete().catch(() => {});

  } catch (err) {
    console.error('❌ Błąd zamykania ticketu:', err.message);
  }
}

// ─── WEBHOOK HELPER ───────────────────────────────────────────────────────────
async function sendViaWebhook(channel, content, username, avatarURL) {
  try {
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.owner?.id === client.user?.id && w.name === 'SS Shop LC');

    if (!webhook) {
      webhook = await channel.createWebhook({
        name: 'SS Shop LC',
        avatar: SS_SHOP_EMOJI_URL,
        reason: 'Auto legit check webhook'
      });
    }

    const sent = await webhook.send({
      content,
      username:  username  || 'Klient',
      avatarURL: avatarURL || `https://cdn.discordapp.com/embed/avatars/0.png`,
    });

    const fetchedMsg = await channel.messages.fetch(sent.id).catch(() => null);
    return fetchedMsg;
  } catch (err) {
    console.error('❌ Błąd sendViaWebhook:', err.message);
    return await channel.send(content).catch(() => null);
  }
}

// ─── BOT ──────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  console.log(`✅ Bot zalogowany jako ${client.user.tag}`);

  await initDB();
  await sendOrUpdateKalkulator();
  await sendOrUpdateCennik();
  await sendOrUpdateMetody();

  setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
      if (!members) return;

      for (const [, member] of members) {
        if (member.user.bot) continue;

        const presence = member.presence;
        const isOffline =
          !presence ||
          presence.status === 'offline' ||
          presence.status === 'invisible';

        if (isOffline) continue;

        await checkAndUpdateAutoRole(member);
      }
    } catch (err) {
      console.error('❌ Błąd interwału auto-roli:', err.message);
    }
  }, 30 * 1000);
});

// ─── GUILD MEMBER UPDATE ──────────────────────────────────────────────────────
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== GUILD_ID) return;
    await checkAndUpdateAutoRole(newMember);
  } catch (err) {
    console.error('❌ Błąd guildMemberUpdate:', err.message);
  }
});

// ─── ANTI-INVITE ──────────────────────────────────────────────────────────────
const DISCORD_LINK_REGEX = /(discord\.gg\/|discord\.com\/invite\/|dsc\.gg\/)/i;

// ─── MESSAGE CREATE ───────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.channel.id === DROP_CHANNEL_ID) {
    await message.delete().catch(() => {});
    return;
  }

  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  if (message.guild.ownerId === message.author.id) return;
  if (!DISCORD_LINK_REGEX.test(message.content)) return;

  try {
    await message.delete();
    await message.author.send(
      '🚫 **Nie wysyłaj linków do żadnego discorda!**\nZa karę dostajesz przerwę na **7 dni**. Przemyśl sobie co zrobiłeś.'
    ).catch(() => {});
    await message.member.timeout(7 * 24 * 60 * 60 * 1000, 'Wysłanie linku do Discorda');
    const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🔨 Przerwa za link do Discorda')
          .setThumbnail(message.author.displayAvatarURL())
          .addFields(
            { name: '👤 Użytkownik', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
            { name: '🆔 ID',         value: `\`${message.author.id}\``,                         inline: true },
            { name: '📝 Kanał',      value: `<#${message.channel.id}>`,                         inline: true },
            { name: '💬 Treść',      value: `\`\`\`${message.content.slice(0, 200)}\`\`\`` },
            { name: '⏱️ Czas',       value: '7 dni',                                            inline: true },
            { name: '🕐 Data',       value: `<t:${Math.floor(Date.now() / 1000)}:F>`,           inline: true }
          )
          .setFooter({ text: 'SS Shop | System anty-link' })]
      });
    }
  } catch (err) {
    console.error('❌ Błąd anti-invite:', err.message);
  }
});

// ─── LEGIT CHECK LISTENER ────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (message.channel.id !== LEGIT_CHECK_CHANNEL_ID) return;

  const match = message.content.match(/^\+rep <@!?(\d+)> .+ \d+ PLN$/i);
  if (!match) return;

  await message.react('✅').catch(() => {});

  for (const [channelId, done] of legitCheckMap.entries()) {
    if (done) continue;

    const ticketData = await pool.query(
      `SELECT * FROM tickets WHERE channel_id = $1`,
      [channelId]
    ).catch(() => null);

    if (!ticketData || ticketData.rows.length === 0) continue;
    const ticket = ticketData.rows[0];

    if (message.author.id !== ticket.user_id) continue;

    legitCheckMap.set(channelId, true);

    const ticketChannel = await client.channels.fetch(channelId).catch(() => null);
    if (ticketChannel) {
      await closeTicket(ticketChannel, message.author);
    }
    break;
  }
});

// ─── INTERAKCJE ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── DROP: slash command /drop ──────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'drop') {

    if (interaction.channel.id !== DROP_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${DROP_CHANNEL_ID}>!`, flags: 64 });
    }

    const hasRole = interaction.member.roles.cache.has(DROP_REQUIRED_ROLE);
    if (!hasRole) {
      const errEmbed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setAuthor({ name: 'SSshop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 SSshop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          {
            name: '👤 Użytkownik',
            value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`,
            inline: true
          },
          { name: '🆔 ID', value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '❌ Brak dostępu', value: 'Nie masz wymaganej rangi do użycia tej komendy!', inline: false }
        )
        .setFooter({ text: 'SSshop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [errEmbed] });
    }

    const dropData = await getDropData(interaction.user.id);
    const now      = Date.now();
    const remaining = DROP_COOLDOWN_MS - (now - dropData.last_drop);

    if (remaining > 0) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setAuthor({ name: 'SSshop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 SSshop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          {
            name: '👤 Użytkownik',
            value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`,
            inline: true
          },
          { name: '🆔 ID', value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '❌ Wynik', value: 'Masz Cooldown! — poczekaj 2h!', inline: false },
          {
            name: '⏳ Dostępny za',
            value: `<t:${Math.floor((dropData.last_drop + DROP_COOLDOWN_MS) / 1000)}:R>`,
            inline: false
          },
        )
        .setFooter({ text: 'SSshop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const nagroda = losujNagrode();

    if (!nagroda) {
      await saveDropData(interaction.user.id, now, dropData.nagrody);
      await logDropResult(interaction, null);

      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({ name: 'SSshop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 SSshop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          {
            name: '👤 Użytkownik',
            value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`,
            inline: true
          },
          { name: '🆔 ID', value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '❌ Wynik', value: 'Tym razem nic się nie trafiło. Spróbuj za 2 godziny!', inline: false },
          {
            name: '⏳ Następny drop',
            value: `<t:${Math.floor((now + DROP_COOLDOWN_MS) / 1000)}:R>`,
            inline: false
          },
        )
        .setFooter({ text: 'SSshop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    dropData.nagrody.push(nagroda.nazwa);
    await saveDropData(interaction.user.id, now, dropData.nagrody);
    await logDropResult(interaction, nagroda);

    const embedWin = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setAuthor({ name: 'SSshop × DROP', iconURL: SS_SHOP_EMOJI_URL })
      .setTitle('🎁 SSshop × DROP')
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        {
          name: '👤 Użytkownik',
          value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`,
          inline: true
        },
        { name: '🆔 ID', value: `\`${interaction.user.id}\``, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎉 Nagroda', value: `${nagroda.emoji} **${nagroda.nazwa}**`, inline: true },
        {
          name: '⏳ Następny drop',
          value: `<t:${Math.floor((now + DROP_COOLDOWN_MS) / 1000)}:R>`,
          inline: true
        },
        { name: '\u200B', value: '\u200B', inline: true },
      )
      .setFooter({ text: 'SSshop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();

    return interaction.reply({ embeds: [embedWin] });
  }

  // ── TOKENGIVE ─────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'tokengive') {
    if (interaction.user.id !== DICE_OWNER_ID) {
      return interaction.reply({ content: '❌ Nie masz uprawnień do tej komendy.', flags: 64 });
    }

    const targetUser = interaction.options.getUser('uzytkownik');
    const ilosc      = interaction.options.getInteger('ilosc');

    if (!targetUser || !ilosc || ilosc <= 0) {
      return interaction.reply({ content: '❌ Podaj prawidłowego użytkownika i ilość tokenów.', flags: 64 });
    }

    await addTokens(targetUser.id, ilosc);
    const nowyBalans = await getTokens(targetUser.id);

    const embed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setTitle('🎟️ Tokeny nadane!')
      .setThumbnail(targetUser.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '👤 Użytkownik',    value: `<@${targetUser.id}> (\`${targetUser.username}\`)`, inline: true },
        { name: '🎟️ Dodano tokenów', value: `**${ilosc}**`,                                    inline: true },
        { name: '💰 Nowy balans',   value: `**${nowyBalans}** tokenów`,                        inline: true }
      )
      .setFooter({ text: 'SS Shop | System Tokenów', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── DICE ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'dice') {
    if (interaction.channel.id !== DICE_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${DICE_CHANNEL_ID}>!`, flags: 64 });
    }

    const hasRole = interaction.member.roles.cache.has(DICE_REQUIRED_ROLE);
    if (!hasRole) {
      return interaction.reply({ content: '❌ Nie masz wymaganej rangi do użycia tej komendy!', flags: 64 });
    }

    const tokeny = await getTokens(interaction.user.id);
    if (tokeny < 1) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🎲 SSshop × Dice')
        .setDescription(`❌ **Nie masz żetonów!**\nKup żetony, aby móc grać.\n\n🎟️ Twój balans: **0 tokenów**`)
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setFooter({ text: 'SS Shop | Dice System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_dice')
      .setTitle('🎲 Dice — SS Shop');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('stawka_tokenow')
          .setLabel(`Stawka w tokenach (masz ${tokeny}, 1 token = 30k $)`)
          .setPlaceholder('np. 1, 2, 5')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('wybrany_numerek')
          .setLabel('Wybierz numerek od 1 do 10')
          .setPlaceholder('Wpisz liczbę od 1 do 10')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ── MODAL: DICE ───────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_dice') {
    if (interaction.channel.id !== DICE_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${DICE_CHANNEL_ID}>!`, flags: 64 });
    }
    const hasRole = interaction.member.roles.cache.has(DICE_REQUIRED_ROLE);
    if (!hasRole) {
      return interaction.reply({ content: '❌ Nie masz wymaganej rangi!', flags: 64 });
    }

    const stawkaInput  = interaction.fields.getTextInputValue('stawka_tokenow').trim();
    const numerekInput = interaction.fields.getTextInputValue('wybrany_numerek').trim();

    const stawkaTokeny = parseInt(stawkaInput, 10);
    const numerek      = parseInt(numerekInput, 10);

    if (isNaN(stawkaTokeny) || stawkaTokeny < 1) {
      return interaction.reply({ content: '❌ Nieprawidłowa stawka! Wpisz liczbę tokenów, np. `1`, `2`, `5`.', flags: 64 });
    }

    if (isNaN(numerek) || numerek < 1 || numerek > 10) {
      return interaction.reply({ content: '❌ Nieprawidłowy numerek! Wybierz liczbę od **1 do 10**.', flags: 64 });
    }

    // Sprawdź tokeny
    const tokeny = await getTokens(interaction.user.id);
    if (tokeny < stawkaTokeny) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🎲 SSshop × Dice — Brak tokenów!')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(
          `❌ **Nie masz wystarczająco tokenów!**\n\n` +
          `🎟️ Twój balans: **${tokeny} tokenów**\n` +
          `🎯 Chciałeś postawić: **${stawkaTokeny} tokenów**\n\n` +
          `Brakuje Ci **${stawkaTokeny - tokeny}** tokenów.`
        )
        .setFooter({ text: 'SS Shop | Dice System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    // Odejmij tokeny
    await removeTokens(interaction.user.id, stawkaTokeny);
    const tokenyPo = await getTokens(interaction.user.id);

    await interaction.deferReply();

    // Oblicz wartości
    const wartoscStawki = stawkaTokeny * TOKEN_VALUE;           // np. 2 tokeny * 30k = 60k
    const wygranaSum    = wartoscStawki * numerek;              // np. 60k * 6 = 360k
    const { wygral, roll, szansa } = rollDice(numerek);

    // Animacja kostki
    const kostki = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const randomKostka = () => kostki[Math.floor(Math.random() * kostki.length)];

    await interaction.editReply({
      content: `🎲 Rzucam kostką... ${randomKostka()} ${randomKostka()} ${randomKostka()}`
    });

    await new Promise(r => setTimeout(r, 1200));

    // Wylosowana liczba (pseudo - pokazujemy roll jako "wylosowaną" wartość 1-100)
    // Dla czytelności pokażemy wylosowany numerek (1-10) symulowany z roll
    const wylosowanyNumerek = (roll % 10) + 1;

    if (wygral) {
      activeWins.set(interaction.user.id, {
        wygrana: wygranaSum,
        timestamp: Date.now()
      });

      const embedWin = new EmbedBuilder()
        .setColor(0x00cc44)
        .setTitle('🎲 SSshop × Dice — WYGRANA! 🎉')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          { name: '👤 Gracz',              value: `<@${interaction.user.id}>`,                                inline: true  },
          { name: '🎯 Twój numerek',        value: `**${numerek}**`,                                          inline: true  },
          { name: '🎟️ Postawiono tokenów',  value: `**${stawkaTokeny}** (= ${formatDolary(wartoscStawki)} $)`, inline: true  },
          { name: '🏆 Wygrana',            value: `**${formatDolary(wygranaSum)} $** (x${numerek})`,          inline: true  },
          { name: '🎟️ Tokeny pozostałe',    value: `**${tokenyPo}**`,                                         inline: true  }
        )
        .setDescription(
          `🎉 **WYGRAŁEŚ!** Trafiłeś numerek **${numerek}**!\n\n` +
          `Stawka: **${stawkaTokeny} tokenów** × **${numerek}** = **${formatDolary(wygranaSum)} $**\n` +
          `*(${stawkaTokeny} tokenów × 30k × ${numerek} = ${formatDolary(wygranaSum)} $)*\n\n` +
          `💡 Użyj \`/double\` aby podwoić wygraną (lub stracić wszystko)!`
        )
        .setFooter({ text: `SS Shop | Dice System`, iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.editReply({ content: null, embeds: [embedWin] });

    } else {
      activeWins.delete(interaction.user.id);

      const embedLose = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle('🎲 SSshop × Dice — Przegrana')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          { name: '👤 Gracz',              value: `<@${interaction.user.id}>`,                                  inline: true },
          { name: '🎯 Twój numerek',        value: `**${numerek}**`,                                            inline: true },
          { name: '🎟️ Postawiono tokenów',  value: `**${stawkaTokeny}** (= ${formatDolary(wartoscStawki)} $)`,  inline: true },
          { name: '💸 Przegrana',           value: `**${formatDolary(wartoscStawki)} $**`,                      inline: true },
          { name: '🎟️ Tokeny pozostałe',    value: `**${tokenyPo}**`,                                           inline: true }
        )
        .setDescription(`❌ **Nie trafiłeś!** Tym razem szczęście nie dopisało.\n\nSpróbuj ponownie — żetonów można kupić więcej!`)
        .setFooter({ text: `SS Shop | Dice System `, iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.editReply({ content: null, embeds: [embedLose] });
    }
  }

  // ── DOUBLE ────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'double') {
    if (interaction.channel.id !== DICE_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${DICE_CHANNEL_ID}>!`, flags: 64 });
    }

    const hasRole = interaction.member.roles.cache.has(DICE_REQUIRED_ROLE);
    if (!hasRole) {
      return interaction.reply({ content: '❌ Nie masz wymaganej rangi!', flags: 64 });
    }

    const winData = activeWins.get(interaction.user.id);
    if (!winData) {
      return interaction.reply({
        content: '❌ **Nie masz aktywnej wygranej!**\nMusisz najpierw wygrać w `/dice`, żeby użyć `/double`.',
        flags: 64
      });
    }

    const { wygrana } = winData;

    await interaction.deferReply();

    const wygranaDouble = Math.random() < 0.01;

    const kostki = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    await interaction.editReply({
      content: `🎲 Double or Nothing... ${kostki[Math.floor(Math.random() * kostki.length)]} ${kostki[Math.floor(Math.random() * kostki.length)]}`
    });

    await new Promise(r => setTimeout(r, 1200));

    activeWins.delete(interaction.user.id);

    if (wygranaDouble) {
      const wygranaX2 = wygrana * 2;

      const embedWin = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🎲 SSshop × Double — DOUBLE WYGRANA! 🎉🎉')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(
          `🔥 **NIESAMOWITE!** Podwoiłeś swoją wygraną!\n\n` +
          `Poprzednia wygrana: **${formatDolary(wygrana)} $**\n` +
          `✅ Nowa wygrana po double: **${formatDolary(wygranaX2)} $**\n\n` +
          `Gratulacje! 🏆`
        )
        .addFields(
          { name: '👤 Gracz',          value: `<@${interaction.user.id}>`,         inline: true },
          { name: '💰 Poprzednia',      value: `**${formatDolary(wygrana)} $**`,    inline: true },
          { name: '🏆 Po double (x2)', value: `**${formatDolary(wygranaX2)} $**`,  inline: true }
        )
        .setFooter({ text: 'SS Shop | Double System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.editReply({ content: null, embeds: [embedWin] });

    } else {
      const embedLose = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('🎲 SSshop × Double — Straciłeś wszystko!')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(
          `💸 **Tym razem się nie udało...**\n\n` +
          `Straciłeś całą wygraną: **${formatDolary(wygrana)} $**\n\n` +
          `Takie jest ryzyko double — następnym razem może pójdzie lepiej!`
        )
        .addFields(
          { name: '👤 Gracz',     value: `<@${interaction.user.id}>`,       inline: true },
          { name: '💸 Stracono', value: `**${formatDolary(wygrana)} $**`,   inline: true },
          { name: '😭 Wynik',    value: '**Nic**',                           inline: true }
        )
        .setFooter({ text: 'SS Shop | Double System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();

      return interaction.editReply({ content: null, embeds: [embedLose] });
    }
  }

  // ── MASSROLE ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'massrole') {
    if (interaction.user.id !== '1215343846003576872') {
      return interaction.reply({ content: '❌ Brak dostępu.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const mode   = interaction.options.getString('mode');
    const roleId = interaction.options.getString('role_id');
    const userId = interaction.options.getString('user_id');
    const guild  = interaction.guild;
    if (!guild) return interaction.editReply('❌ Brak serwera.');

    let added = 0, skipped = 0, processed = 0;
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const startTime = Date.now();

    function formatTime(ms) { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}m ${sec % 60}s`; }
    function progressBar(current, total, size = 12) {
      const filled = Math.round(total ? (current / total) * size : 0);
      return '█'.repeat(filled) + '░'.repeat(size - filled);
    }

    let heartbeat;
    async function update(total) {
      const elapsed = Date.now() - startTime;
      const speed   = processed / (elapsed / 1000 || 1);
      const eta     = speed > 0 ? ((total - processed) / speed) * 1000 : 0;
      await interaction.editReply(
        `⏳ **MassRole LIVE**\n\n` +
        `📊 ${progressBar(processed, total)}\n` +
        `🔢 ${processed}/${total}\n\n` +
        `➕ Dodano: ${added}\n` +
        `⏭️ Pominięto: ${skipped}\n\n` +
        `⚡ ${speed.toFixed(2)} users/sec\n` +
        `⏱️ ETA: ${formatTime(eta)}`
      );
    }

    async function give(member) {
      try {
        if (!member.roles.cache.has(roleId)) { await member.roles.add(roleId); added++; }
        else skipped++;
      } catch {}
    }

    await guild.members.fetch({ force: true });
    let members = [];
    if (mode === 'all')     members = [...guild.members.cache.values()];
    if (mode === 'without') members = [...guild.members.cache.values()].filter(m => !m.roles.cache.has(roleId));
    if (mode === 'id') {
      if (!userId) return interaction.editReply('❌ Brak user_id!');
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.editReply('❌ Nie znaleziono użytkownika!');
      members = [member];
    }

    const total = members.filter(m => !m.user.bot).length;
    heartbeat = setInterval(() => update(total), 2000);
    for (const m of members) {
      if (m.user.bot) continue;
      await give(m);
      processed++;
      await delay(450);
    }
    clearInterval(heartbeat);
    return interaction.editReply(
      `✅ **DONE MASSROLE**\n\n` +
      `📊 ${progressBar(processed, total)}\n` +
      `🔢 ${processed}/${total}\n` +
      `➕ Dodano: ${added}\n` +
      `⏭️ Pominięto: ${skipped}`
    );
  }

  // ── KALKULATOR: ile dostanę ────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_dostane') {
    await interaction.reply({ content: '💜 **Krok 1 z 2** — Wybierz metodę płatności:', components: [buildSelectMenuRow('select_ile_dostane')], flags: 64 });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ile_dostane') {
    const metodaKey = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`modal_ile_dostane_${metodaKey}`).setTitle('💰 Ile dolarów serwerowych dostanę?');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('kwota_zl').setLabel('Podaj kwotę w zł (np. 10zł, 100zł)').setPlaceholder('Wpisz kwotę z "zł" na końcu, np. 10zł').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)
    ));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ile_dostane_')) {
    const metodaKey    = interaction.customId.replace('modal_ile_dostane_', '');
    const metoda       = PROWIZJE[metodaKey];
    const kwotaZl      = parseZloty(interaction.fields.getTextInputValue('kwota_zl'));
    if (!kwotaZl) {
      await interaction.reply({ content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`zł\` na końcu, np. \`10zł\`.`, flags: 64 });
      return;
    }
    const po_prowizji_zl = kwotaZl * (1 - metoda.prowizja / 100);
    const prowizja_zl    = kwotaZl - po_prowizji_zl;
    const dolary         = po_prowizji_zl * PRZELICZNIK;
    await interaction.reply({
      content:
        `💜 **Wynik kalkulatora SS Shop:**\n\n` +
        `${metoda.emoji} Metoda: **${metoda.nazwa}**\n` +
        `💵 Wysyłasz: **${kwotaZl.toFixed(2)} zł**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **-${prowizja_zl.toFixed(2)} zł**\n` +
        `💜 Dolary serwerowe, które otrzymasz: **${formatDolary(dolary)} $**`,
      flags: 64
    });
    return;
  }

  // ── KALKULATOR: ile zapłacić ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_zaplacic') {
    await interaction.reply({ content: '💜 **Krok 1 z 2** — Wybierz metodę płatności:', components: [buildSelectMenuRow('select_ile_zaplacic')], flags: 64 });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ile_zaplacic') {
    const metodaKey = interaction.values[0];
    const modal = new ModalBuilder().setCustomId(`modal_ile_zaplacic_${metodaKey}`).setTitle('💸 Ile zapłacić za tyle dolarów?');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('kwota_dolary').setLabel('Podaj kwotę $ (np. 80k, 800k, 1m)').setPlaceholder('Wpisz kwotę z "k" lub "m", np. 80k').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)
    ));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ile_zaplacic_')) {
    const metodaKey = interaction.customId.replace('modal_ile_zaplacic_', '');
    const metoda    = PROWIZJE[metodaKey];
    const dolary    = parseDolary(interaction.fields.getTextInputValue('kwota_dolary'));
    if (!dolary) {
      await interaction.reply({ content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`k\` lub \`m\`, np. \`80k\`, \`1m\`.`, flags: 64 });
      return;
    }
    const bazowa_cena_zl = dolary / PRZELICZNIK;
    const do_zaplaty_zl  = bazowa_cena_zl / (1 - metoda.prowizja / 100);
    const prowizja_zl    = do_zaplaty_zl - bazowa_cena_zl;
    await interaction.reply({
      content:
        `💜 **Wynik kalkulatora SS Shop:**\n\n` +
        `${metoda.emoji} Metoda: **${metoda.nazwa}**\n` +
        `💜 Chcesz otrzymać: **${formatDolary(dolary)} $**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **+${prowizja_zl.toFixed(2)} zł**\n` +
        `💵 Musisz zapłacić łącznie: **${do_zaplaty_zl.toFixed(2)} zł**`,
      flags: 64
    });
    return;
  }

  // ── KUP PELERYNKĘ → modal ──────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kup_pelerynke') {
    const modal = new ModalBuilder().setCustomId('modal_kup_pelerynke').setTitle('🛍️ Zakup pelerynki — SS Shop');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('nazwa_pelerynki')
        .setLabel('Wpisz PEŁNĄ nazwę pelerynki lub "zestaw"')
        .setPlaceholder('np. Home Cape / Copper Cape / Purple Heart / MCE Cape / Menace / zestaw')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(50)
    ));
    await interaction.showModal(modal);
    return;
  }

  // ── MODAL: zakup pelerynki → wybór metody płatności ───────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_kup_pelerynke') {
    const input     = interaction.fields.getTextInputValue('nazwa_pelerynki');
    const pelerynka = znajdzPelerynke(input);

    if (!pelerynka) {
      await interaction.reply({
        content:
          `❌ **Nie rozpoznano nazwy pelerynki!**\n\n` +
          `Musisz wpisać **pełną nazwę** jednej z pelerynek:\n` +
          `> \`Home Cape\`, \`Copper Cape\`, \`Menace\`, \`Purple Heart\`, \`MCE Cape\`\n` +
          `> lub \`zestaw\` jeśli chcesz kupić kilka\n\nSpróbuj ponownie! 💜`,
        flags: 64
      });
      return;
    }

    const opis = pelerynka.key === 'zestaw'
      ? `${pelerynka.emoji} **Zestaw** — cena do ustalenia`
      : `${pelerynka.emoji} **${pelerynka.nazwaDisplay}** — baza: \`${pelerynka.cena} zł\``;

    await interaction.reply({
      content:
        `💜 **Krok 2 z 2 — Wybierz metodę płatności**\n\n` +
        `${opis}\n\n` +
        `Wybierz metodę płatności, a bot automatycznie wyliczy finalną cenę z prowizją:`,
      components: [buildMetodyTicketuRow(pelerynka.key)],
      flags: 64
    });
    return;
  }

  // ── SELECT: wybór metody płatności dla ticketu ────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_metoda_platnosci_')) {
    const pelerynkaKey = interaction.customId.replace('select_metoda_platnosci_', '');
    const metodaKey    = interaction.values[0];
    const pelerynka    = { key: pelerynkaKey, ...PELERYNKI[pelerynkaKey] };
    const metoda       = TICKET_METODY[metodaKey];

    if (!pelerynka || !metoda) {
      await interaction.reply({ content: '❌ Wystąpił błąd. Spróbuj ponownie.', flags: 64 });
      return;
    }

    let cenaTekst, opisCena;
    if (pelerynka.key === 'zestaw') {
      if (metoda.prowizja > 0) {
        cenaTekst = `Do ustalenia + ${metoda.prowizja}% prowizji`;
        opisCena  = `💵 Cena: **Do ustalenia** *(+ ${metoda.prowizja}% prowizji ${metoda.nazwa})*`;
      } else {
        cenaTekst = `Do ustalenia`;
        opisCena  = `💵 Cena: **Do ustalenia**`;
      }
    } else {
      const cenaBaza = pelerynka.cena;
      if (metoda.prowizja > 0) {
        const cenaFinal = obliczCeneZProwizja(cenaBaza, metoda.prowizja);
        cenaTekst = `${cenaBaza} zł + ${metoda.prowizja}% = ${cenaFinal} zł`;
        opisCena  = `💵 Cena: \`${cenaBaza} zł\` + \`${metoda.prowizja}%\` prowizji = **${cenaFinal} zł**`;
      } else {
        cenaTekst = `${cenaBaza} zł`;
        opisCena  = `💵 Cena: **${cenaBaza} zł** *(bez prowizji)*`;
      }
    }

    await interaction.deferReply({ flags: 64 });

    const guild  = interaction.guild;
    const result = await createTicketChannel(guild, interaction.user, pelerynka.nazwaDisplay, cenaTekst, metodaKey);

    if (result.exists) {
      await interaction.editReply({ content: `❌ **Masz już otwarty ticket!**\nZajrzyj do kanału <#${result.channelId}> i tam dokończ zakup. 💜` });
      return;
    }

    await sendTicketWelcome(result.channel, interaction.user, pelerynka.nazwaDisplay, cenaTekst, metodaKey);
    await interaction.editReply({
      content:
        `✅ **Ticket został otwarty!**\n\n` +
        `${pelerynka.emoji} Pelerynka: **${pelerynka.nazwaDisplay}**\n` +
        `${opisCena}\n` +
        `💳 Metoda płatności: **${metoda.emoji} ${metoda.nazwa}**\n\n` +
        `📩 Kanał: <#${result.channel.id}>\n` +
        `Obsługa wkrótce się z Tobą skontaktuje 💜`
    });
    return;
  }

  // ── PRZEJMIJ TICKET ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'przejmij_ticket') {
    const ticketData = await pool.query(
      `SELECT * FROM tickets WHERE channel_id = $1`,
      [interaction.channel.id]
    );
    const ticket = ticketData.rows[0];

    if (!ticket) {
      return interaction.reply({ content: '❌ Nie znaleziono ticketu w bazie danych.', flags: 64 });
    }
    if (ticket.taken_by_user_id) {
      return interaction.reply({ content: `❌ Ten ticket został już przejęty przez <@${ticket.taken_by_user_id}>.`, flags: 64 });
    }

    await pool.query(
      `UPDATE tickets SET taken_by_user_id = $1, taken_by_username = $2 WHERE channel_id = $3`,
      [interaction.user.id, interaction.user.username, interaction.channel.id]
    );

    const newName = `przejete-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
    await interaction.channel.setName(newName).catch(() => {});

    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { ViewChannel: false }).catch(() => {});
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    }).catch(() => {});
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    }).catch(() => {});

    const updatedActionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('zamknij_ticket')
        .setLabel('🔒 Zamknij Ticket')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.message.edit({
      embeds: interaction.message.embeds,
      components: [updatedActionRow]
    }).catch(() => {});

    await interaction.reply({
      content: `✅ <@${interaction.user.id}> przejął ticket i zajmie się obsługą klienta! 💜`
    });
    return;
  }

  // ── ZAMKNIJ TICKET ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'zamknij_ticket') {
    const ticketData = await pool.query(
      `SELECT * FROM tickets WHERE channel_id = $1`,
      [interaction.channel.id]
    );
    const ticket = ticketData.rows[0];

    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isOwner = ticket && ticket.user_id === interaction.user.id;
    const isTaker = ticket && ticket.taken_by_user_id === interaction.user.id;

    if (!isAdmin && !isOwner && !isTaker) {
      return interaction.reply({ content: '❌ Tylko admin, właściciel ticketu lub osoba, która go przejęła, może go zamknąć!', flags: 64 });
    }

    if (ticket && ticket.taken_by_user_id) {
      const modal = new ModalBuilder()
        .setCustomId('modal_zamknij_ticket')
        .setTitle('🔒 Zamknij Ticket - Szczegóły transakcji');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('kwota_wydana')
            .setLabel('Ile zł wydała osoba kupująca?')
            .setPlaceholder('np. 100')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(10)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('pelerynka_kupiona')
            .setLabel('Jaką pelerynkę kupiła?')
            .setPlaceholder('np. Home Cape')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50)
        )
      );
      await interaction.showModal(modal);
    } else {
      await interaction.deferReply({ flags: 64 });
      await closeTicket(interaction.channel, interaction.user);
    }
    return;
  }

  // ── MODAL: ZAMKNIJ TICKET ─────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'modal_zamknij_ticket') {
    await interaction.deferReply({ flags: 64 });

    const kwotaWydana      = interaction.fields.getTextInputValue('kwota_wydana');
    const pelerynkaKupiona = interaction.fields.getTextInputValue('pelerynka_kupiona');

    const ticketData = await pool.query(
      `SELECT * FROM tickets WHERE channel_id = $1`,
      [interaction.channel.id]
    );
    const ticket = ticketData.rows[0];
    if (!ticket) return interaction.editReply({ content: '❌ Nie znaleziono ticketu w bazie danych.' });

    const legitCheckChannel = await client.channels.fetch(LEGIT_CHECK_CHANNEL_ID).catch(() => null);
    if (!legitCheckChannel) return interaction.editReply({ content: '❌ Nie znaleziono kanału do legit checków.' });

    let clientUsername  = ticket.username || ticket.user_id;
    let clientAvatarURL = `https://cdn.discordapp.com/embed/avatars/0.png`;
    try {
      const clientUser = await client.users.fetch(ticket.user_id);
      clientUsername  = clientUser.username;
      clientAvatarURL = clientUser.displayAvatarURL({ extension: 'png', size: 256, forceStatic: false });
    } catch {}

    const metodaKey  = ticket.metoda_platnosci || null;
    const metoda     = metodaKey ? TICKET_METODY[metodaKey] : null;
    const metodaInfo = metoda
      ? `${metoda.emoji} ${metoda.nazwa}${metoda.prowizja > 0 ? ` (+${metoda.prowizja}% prowizji)` : ' (bez prowizji)'}`
      : 'nieznana';

    const legitCheckEmbed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setTitle('✅ Transakcja zakończona pomyślnie!')
      .setDescription(
        `Witaj <@${ticket.user_id}>!\n\n` +
        `Twoja transakcja została zakończona przez <@${ticket.taken_by_user_id}>.\n\n` +
        `Aby potwierdzić zakup, przejdź na kanał <#${LEGIT_CHECK_CHANNEL_ID}> i wyślij tam wiadomość w formacie:\n` +
        `\`\`\`+rep <@${ticket.taken_by_user_id}> ${pelerynkaKupiona} ${kwotaWydana} PLN\`\`\`\n` +
        `Masz na to **10 minut** — po tym czasie bot wyśle legit check automatycznie.`
      )
      .addFields(
        { name: '🛒 Pelerynka',          value: pelerynkaKupiona,                   inline: true  },
        { name: '💵 Kwota',              value: `${kwotaWydana} PLN`,               inline: true  },
        { name: '💳 Metoda płatności',   value: metodaInfo,                         inline: true  },
        { name: '👤 Obsługa',            value: `<@${ticket.taken_by_user_id}>`,    inline: true  },
        { name: '📢 Kanał legit check',  value: `<#${LEGIT_CHECK_CHANNEL_ID}>`,     inline: false }
      )
      .setFooter({ text: 'SS Shop | Legit Check' })
      .setTimestamp();

    const sentMessage = await interaction.channel.send({ content: `<@${ticket.user_id}>`, embeds: [legitCheckEmbed] });

    legitCheckMap.set(interaction.channel.id, false);

    await pool.query(
      `UPDATE tickets SET legit_check_msg_id = $1 WHERE channel_id = $2`,
      [sentMessage.id, interaction.channel.id]
    );

    await interaction.editReply({ content: '✅ Wysłano wiadomość z prośbą o legit check. Ticket zostanie zamknięty po 10 minutach lub po wysłaniu legit checka przez klienta.' });

    const channelIdSnapshot = interaction.channel.id;
    const ticketSnapshot    = { ...ticket };
    const usernameSnapshot  = clientUsername;
    const avatarSnapshot    = clientAvatarURL;
    const pelerynkaSnapshot = pelerynkaKupiona;
    const kwotaSnapshot     = kwotaWydana;

    setTimeout(async () => {
      try {
        const done = legitCheckMap.get(channelIdSnapshot);
        if (done) return;

        const autoMsg = await sendViaWebhook(
          legitCheckChannel,
          `+rep <@${ticketSnapshot.taken_by_user_id}> ${pelerynkaSnapshot} ${kwotaSnapshot} PLN`,
          usernameSnapshot,
          avatarSnapshot
        );
        if (autoMsg) await autoMsg.react('✅').catch(() => {});

        legitCheckMap.set(channelIdSnapshot, true);

        const ticketCh = await client.channels.fetch(channelIdSnapshot).catch(() => null);
        if (ticketCh) await closeTicket(ticketCh, client.user);

      } catch (err) {
        console.error('❌ Błąd timera legit check:', err.message);
      }
    }, 10 * 60 * 1000);

    return;
  }

  // ── WERYFIKACJA ───────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'verify') {
    const oauthUrl =
      `https://discord.com/oauth2/authorize` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent('identify guilds.join')}` +
      `&state=${interaction.user.id}`;
    await interaction.reply({ content: `Kliknij link poniżej, aby się zweryfikować:\n🔗 ${oauthUrl}`, flags: 64 });
    return;
  }

  // ── KOMENDA: setup-verify ─────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', flags: 64 });
    }
    const embed = new EmbedBuilder()
      .setColor('#6a00ff')
      .setAuthor({
        name: '💜 SS | Shop 💜 × Weryfikacja',
        iconURL: 'https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png'
      })
      .setThumbnail('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png')
      .setDescription(
        '>>> Aby uzyskać pełny dostęp do serwera **SS Shop**, musisz przejść proces weryfikacji.\n' +
        'Kliknij przycisk poniżej, aby połączyć swoje konto i uzyskać dostęp do kanałów!'
      )
      .setImage('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png');
    await interaction.channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify').setLabel('✅ Zweryfikuj się').setStyle(ButtonStyle.Success)
      )]
    });
    await interaction.reply({ content: '✅ Wiadomość weryfikacyjna wysłana!', flags: 64 });
    return;
  }

  // ── KOMENDA: transfer ─────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'transfer') {
    if (interaction.user.id !== '1215343846003576872') {
      return interaction.reply({ content: '❌ Nie masz uprawnień do tej komendy.', flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const targetGuildId = interaction.options.getString('guild_id');
    const tryb          = interaction.options.getString('tryb');
    const ilosc         = interaction.options.getInteger('ilosc');
    const targetUserId  = interaction.options.getString('user_id');

    let users = [];
    if (tryb === 'all') {
      const result = await pool.query('SELECT user_id FROM users');
      users = result.rows;
    } else if (tryb === 'random') {
      if (!ilosc) return interaction.editReply({ content: '❌ Podaj ilość osób!' });
      const result = await pool.query('SELECT user_id FROM users ORDER BY RANDOM() LIMIT $1', [ilosc]);
      users = result.rows;
    } else if (tryb === 'id') {
      if (!targetUserId) return interaction.editReply({ content: '❌ Podaj ID użytkownika!' });
      const result = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [targetUserId]);
      if (result.rows.length === 0) return interaction.editReply({ content: '❌ Nie znaleziono użytkownika w bazie!' });
      users = result.rows;
    }

    const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
    if (!targetGuild) return interaction.editReply({ content: '❌ Nie znaleziono serwera docelowego!' });

    let success = 0, failed = 0, alreadyOnServer = 0, deauthorized = 0, notFound = 0;
    const BATCH_SIZE = 5, BATCH_DELAY = 300;

    async function addSingleUser(row) {
      let attempts = 0;
      while (attempts < 3) {
        try {
          const accessToken = await refreshAccessToken(row.user_id);
          if (!accessToken) { failed++; return; }
          const response = await axios.put(
            `https://discord.com/api/guilds/${targetGuildId}/members/${row.user_id}`,
            { access_token: accessToken },
            { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 10_000 }
          );
          if (response.status === 204) { alreadyOnServer++; }
          else {
            success++;
            setImmediate(async () => {
              try {
                await new Promise(r => setTimeout(r, 1500));
                const member = await targetGuild.members.fetch(row.user_id).catch(() => null);
                if (member) { await member.roles.add(TRANSFER_ROLE_ID); await sendWelcomeMessage(member); }
              } catch (err) { console.error(`❌ Błąd rangi/powitania dla ${row.user_id}:`, err.message); }
            });
          }
          return;
        } catch (err) {
          const status = err?.response?.status;
          const data   = err?.response?.data;
          if (status === 429 && data?.retry_after) { await new Promise(r => setTimeout(r, Math.ceil(data.retry_after) + 500)); attempts++; continue; }
          if (data?.code === 50025) { deauthorized++; return; }
          if (data?.code === 10013) { notFound++; return; }
          attempts++;
        }
      }
      failed++;
    }

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(row => addSingleUser(row)));
      if (i + BATCH_SIZE < users.length) await new Promise(r => setTimeout(r, BATCH_DELAY));
    }

    await interaction.editReply({
      content:
        `✅ **Transfer zakończony!**\n` +
        `✅ Dodano: **${success}**\n` +
        `👥 Już na serwerze: **${alreadyOnServer}**\n` +
        `🚫 Odautoryzowali: **${deauthorized}**\n` +
        `👻 Nie znaleziono: **${notFound}**\n` +
        `❌ Inne błędy: **${failed}**`
    });
    return;
  }

});

// ─── NOWY CZŁONEK ─────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async member => {
  if (member.guild.id !== GUILD_ID) return;
  setTimeout(() => checkAndUpdateAutoRole(member), 3000);
});

// ─── PRESENCE UPDATE ──────────────────────────────────────────────────────────
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  try {
    if (!newPresence?.guild || newPresence.guild.id !== GUILD_ID) return;

    const member = await newPresence.guild.members.fetch(newPresence.userId).catch(() => null);
    if (!member || member.user.bot) return;

    const newStatus = newPresence?.status;

    if (newStatus === 'offline' || newStatus === 'invisible') return;

    const newStatusText = newPresence?.activities?.find(a => a.type === 4)?.state || '';
    const newHasLink    = newStatusText.includes(REQUIRED_STATUS_LINK);

    statusLinkCache.set(member.id, newHasLink);

    await checkAndUpdateAutoRole(member);

  } catch (err) {
    console.error('❌ presenceUpdate error:', err);
  }
});

// ─── LOGOWANIE ────────────────────────────────────────────────────────────────
client.login(BOT_TOKEN);

// ─── REJESTRACJA KOMEND ───────────────────────────────────────────────────────
if (process.argv.includes('--setup')) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('drop')
      .setDescription('🎁 Wylosuj nagrodę w SSshop!')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('tokengive')
      .setDescription('🎟️ Nadaj żetony użytkownikowi (tylko właściciel)')
      .addUserOption(opt =>
        opt.setName('uzytkownik').setDescription('Użytkownik, któremu nadajesz żetony').setRequired(true)
      )
      .addIntegerOption(opt =>
        opt.setName('ilosc').setDescription('Ilość żetonów do nadania').setRequired(true).setMinValue(1)
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('dice')
      .setDescription('🎲 Zagraj w kości! Wybierz stawkę w tokenach i numerek.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('double')
      .setDescription('🎰 Podwój swoją wygraną lub strać wszystko!')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('massrole')
      .setDescription('Masowe nadawanie ról (ONLY OWNER)')
      .addStringOption(opt =>
        opt.setName('mode').setDescription('Tryb').setRequired(true)
          .addChoices(
            { name: '👥 Everyone',     value: 'all'     },
            { name: '🚫 Without role', value: 'without' },
            { name: '👤 Single user',  value: 'id'      }
          )
      )
      .addStringOption(opt => opt.setName('role_id').setDescription('ID roli').setRequired(true))
      .addStringOption(opt => opt.setName('user_id').setDescription('ID usera (tylko single)').setRequired(false))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('Wysyła wiadomość weryfikacyjną z przyciskiem')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('transfer')
      .setDescription('Przenosi użytkowników na podany serwer')
      .addStringOption(opt => opt.setName('guild_id').setDescription('ID serwera docelowego').setRequired(true))
      .addStringOption(opt =>
        opt.setName('tryb').setDescription('all = wszyscy, random = losowi, id = konkretna osoba').setRequired(true)
          .addChoices(
            { name: 'Wszyscy',                 value: 'all'    },
            { name: 'Losowi',                  value: 'random' },
            { name: 'Konkretna osoba (po ID)', value: 'id'     }
          )
      )
      .addIntegerOption(opt => opt.setName('ilosc').setDescription('Ile losowych osób (tryb random)').setRequired(false))
      .addStringOption(opt => opt.setName('user_id').setDescription('ID użytkownika (tryb id)').setRequired(false))
      .toJSON()
  ];

  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    .then(() => { console.log('✅ Komendy zarejestrowane!'); process.exit(0); })
    .catch(err => { console.error('❌ Błąd rejestracji komend:', err); process.exit(1); });
}

// ─── SERWER HTTP ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bot działa!'));

app.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).send('❌ Brak kodu autoryzacji lub ID użytkownika.');

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 }
    );

    const accessToken  = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const expiresAt    = Date.now() + tokenRes.data.expires_in * 1000;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000
    });

    const discordUserId = userRes.data.id;
    const username      = userRes.data.username;
    const globalName    = userRes.data.global_name || username;
    const avatar        = userRes.data.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUserId}/${userRes.data.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    await saveUser({ user_id: discordUserId, username, global_name: globalName, avatar, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt });

    await axios.put(
      `https://discord.com/api/guilds/${GUILD_ID}/members/${discordUserId}`,
      { access_token: accessToken },
      { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 10_000 }
    );

    const guild  = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (member) {
      await member.roles.add(ROLE_ID);
      await sendWelcomeMessage(member);
    }

    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x6a00ff)
          .setTitle('✅ Nowa weryfikacja')
          .setThumbnail(avatar)
          .addFields(
            { name: '👤 Użytkownik', value: `${globalName} (\`${username}\`)`, inline: true },
            { name: '🆔 ID',         value: `\`${discordUserId}\``,            inline: true },
            { name: '🕐 Czas',       value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
          )
          .setFooter({ text: 'SS Shop | System weryfikacji' })
          .setTimestamp()]
      });
    }

    return res.send(`
      <html><head><title>Weryfikacja</title></head>
      <body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#23272a;color:#fff">
        <h1>✅ Zweryfikowano!</h1>
        <p>Możesz wrócić na Discord. Ranga została nadana.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('❌ Błąd weryfikacji:', err?.response?.data || err.message);
    return res.status(500).send(`
      <html><head><title>Błąd</title></head>
      <body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#23272a;color:#fff">
        <h1>❌ Wystąpił błąd</h1>
        <p>Spróbuj ponownie lub skontaktuj się z administracją.</p>
      </body></html>
    `);
  }
});

app.listen(PORT, () => { console.log(`✅ Serwer HTTP działa na porcie ${PORT}`); });
