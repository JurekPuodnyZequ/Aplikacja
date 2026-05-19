require('dotenv').config();
let memberCountDebounceTimer = null;
const statusLinkCache = new Map();
const usedCodes = new Set();
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
  ChannelType,
  AttachmentBuilder,
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

const LOG_CHANNEL_ID         = '1505788742445563946';
const WELCOME_CHANNEL_ID     = '1505521873134424221';
const KALKULATOR_CHANNEL_ID  = '1505539734007578705';
const KALKULATOR_MSG_KEY     = 'kalkulator_message_id';
const TRANSFER_ROLE_ID       = '1505521872232644685';

const METODY_CHANNEL_ID      = '1505521873402855450';
const METODY_MSG_KEY         = 'metody_message_id';
const PROPOZYCJE_CHANNEL_ID  = '1505530602953244864';
const PROPOZYCJE_MSG_KEY     = 'propozycje_message_id';

const MEMBER_COUNT_CHANNEL_ID  = '1505521873134424219';
const INVITES_CMD_CHANNEL_ID   = '1505521873621094421';
const LEGIT_CHECK_CHANNEL_ID   = '1505532967500644412';
const LEGIT_CHECK_COUNT_KEY    = 'legit_check_count';
const LEGIT_CHECK2_CHANNEL_ID  = '1505521873402855452';
const LEGIT_CHECK2_COUNT_KEY   = 'legit_check2_count';

const SS_SHOP_EMOJI_URL      = 'https://i.imgur.com/Y65cjjd.png';
const RAVEN_LOGO_URL         = SS_SHOP_EMOJI_URL;

const DROP_CHANNEL_ID    = '1505540703604834335';
const DROP_REQUIRED_ROLE = '1505540086060548116';
const DROP_COOLDOWN_MS   = 2 * 60 * 60 * 1000;

const AUTO_ROLE_ID         = '1505540086060548116';
const REQUIRED_STATUS_LINK = '.gg/y5Eu6YgDRY';

const DROP_NAGRODY = [
  { nazwa: '-2.5% zniżki w CatShop',    emoji: '🏷️', szansa: 3.68 },
  { nazwa: '-5% zniżki w CatShop',      emoji: '🏷️', szansa: 1.472 },
  { nazwa: '-10% zniżki w CatShop',     emoji: '🏷️', szansa: 0.10 },
  { nazwa: '5k Anarchia',               emoji: '💰', szansa: 1.84 },
  { nazwa: '8k Anarchia LF',            emoji: '💰', szansa: 0.50 },
  { nazwa: '15k Anarchia LF',           emoji: '💰', szansa: 0.10 },
  { nazwa: '1zł do wydania na CatShop', emoji: '💵', szansa: 1.472 },
  { nazwa: '2zł do wydania na CatShop', emoji: '💵', szansa: 0.736 },
  { nazwa: '3zł do wydania na CatShop', emoji: '💵', szansa: 0.10 },
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

async function checkAndUpdateAutoRole(member) {
  try {
    if (!member || member.user.bot) return;
    const presence = member.presence;
    const isOfflineOrInvisible =
      !presence ||
      presence.status === 'offline' ||
      presence.status === 'invisible';
    if (isOfflineOrInvisible) return;
    const hasStatusLink = memberHasStatusLink(member);
    const hasRole       = member.roles.cache.has(AUTO_ROLE_ID);
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

async function updateMemberCount(guild) {
  // Anuluj poprzedni timer jeśli istnieje
  if (memberCountDebounceTimer) {
    clearTimeout(memberCountDebounceTimer);
  }
  
  // Poczekaj 5 sekund od ostatniego eventu, potem zaktualizuj raz
  memberCountDebounceTimer = setTimeout(async () => {
    try {
      const channel = await guild.channels.fetch(MEMBER_COUNT_CHANNEL_ID).catch(() => null);
      if (!channel) return;
      const count = guild.memberCount;
      await channel.setName(`╵👪・${count}`);
      console.log(`✅ Licznik członków: ${count}`);
    } catch (err) {
      console.error('❌ Błąd updateMemberCount:', err.message);
    }
  }, 5000);
}

async function updateLegitCheckCount(guild, count) {
  try {
    const channel = await guild.channels.fetch(LEGIT_CHECK_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    await channel.setName(`╵✅・ʀᴀᴅᴀʀ-ʟᴇɢɪᴛᴄʜᴇᴄᴋ・${count}`);
  } catch (err) {
    console.error('❌ Błąd updateLegitCheckCount:', err.message);
  }
}

async function updateLegitCheck2Count(guild, count) {
  try {
    const channel = await guild.channels.fetch(LEGIT_CHECK2_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    await channel.setName(`╵🔎・ʟᴇɢɪᴛ-ᴄʜᴇᴄᴋ・${count}`);
  } catch (err) {
    console.error('❌ Błąd updateLegitCheck2Count:', err.message);
  }
}

async function logDropResult(interaction, nagroda) {
  try {
    const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;
    const embed = new EmbedBuilder()
      .setColor(nagroda ? 0x6a00ff : 0x2B2D31)
      .setTitle(nagroda ? '🎁 Drop — nagroda wylosowana!' : '🎁 Drop — brak nagrody')
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '👤 Użytkownik', value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
        { name: '🆔 ID',         value: `\`${interaction.user.id}\``, inline: true },
        { name: '\u200B',        value: '\u200B', inline: true },
        { name: '🎉 Nagroda',    value: nagroda ? `${nagroda.emoji} **${nagroda.nazwa}**` : '❌ Nic nie wylosowano', inline: false },
        { name: '🕐 Czas',       value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
      )
      .setFooter({ text: 'Cat Shop | Drop System', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌ Błąd logDropResult:', err.message);
  }
}

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

const PRZELICZNIK = 7300;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:ooqqGeeYDMypYAkQVxqJTNBstkLreIzr@postgres.railway.internal:5432/railway',
  ssl: false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initDB() {
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
    CREATE TABLE IF NOT EXISTS drop_data (
      user_id    TEXT PRIMARY KEY,
      last_drop  BIGINT DEFAULT 0,
      nagrody    TEXT DEFAULT '[]'
    )
  `);
  await pool.query(`DROP TABLE IF EXISTS invites`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      user_id  TEXT PRIMARY KEY,
      count    INTEGER DEFAULT 0
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

async function getInviteCount(userId) {
  const res = await pool.query('SELECT count FROM invites WHERE user_id = $1', [userId]);
  return res.rows.length > 0 ? res.rows[0].count : 0;
}

async function incrementInviteCount(userId) {
  await pool.query(`
    INSERT INTO invites (user_id, count) VALUES ($1, 1)
    ON CONFLICT (user_id) DO UPDATE SET count = invites.count + 1
  `, [userId]);
  const res = await pool.query('SELECT count FROM invites WHERE user_id = $1', [userId]);
  return res.rows[0].count;
}

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
    const errData = err?.response?.data;
    if (errData?.error === 'invalid_grant') {
      console.log(`⚠️ Użytkownik ${userId} odautoryzował aplikację — usuwam tokeny z bazy.`);
      await pool.query(`UPDATE users SET access_token=NULL, refresh_token=NULL, expires_at=0 WHERE user_id=$1`, [userId]);
      return null;
    }
    console.error(`❌ Błąd odświeżenia tokenu dla ${userId}:`, errData || err.message);
    return null;
  }
}

// ─── KALKULATOR ───────────────────────────────────────────────────────────────
const PROWIZJE = {
  blik_telefon: { nazwa: 'BLIK na numer telefonu', prowizja: 0,  emoji: '📱' },
  blik_kod:     { nazwa: 'Kod BLIK',               prowizja: 10, emoji: '<:blik:1505930944777818172>' },
  btc:          { nazwa: 'BTC (Bitcoin)',           prowizja: 0,  emoji: '<:BTC:1505930861495713922>' },
  ltc:          { nazwa: 'LTC (Litecoin)',          prowizja: 0,  emoji: '<:LTC:1505930806840004830>' },
  usdt:         { nazwa: 'USDT',                    prowizja: 0,  emoji: '<:USDT:1505930988507762748>' },
  usdc:         { nazwa: 'USDC',                    prowizja: 0,  emoji: '<:USDC:1505930834429874327>' },
  eth:          { nazwa: 'ETH (Ethereum)',           prowizja: 0,  emoji: '<:ether:1505930906957905972>' },
  paypal:       { nazwa: 'PayPal',                  prowizja: 13, emoji: '<:PP:1505931011530297514>' },
  psc_paragon:  { nazwa: 'PSC z paragonem',         prowizja: 13, emoji: '<:PSC:1505930725109792999>' },
  psc_bez:      { nazwa: 'PSC bez paragonu',        prowizja: 20, emoji: '<:PSC:1505930725109792999>' },
  mypsc:        { nazwa: 'MyPSC (tylko)',            prowizja: 25, emoji: '<:MYPSC:1505930776884281546>' },
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
    .setPlaceholder('🐈 Wybierz metodę płatności...')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

function buildKalkulatorComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kalkulator_ile_dostane').setLabel('💰 Ile dolarów serwerowych dostanę?').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kalkulator_ile_zaplacic').setLabel('💸 Ile zapłacić za tyle dolarów serwerowych?').setStyle(ButtonStyle.Secondary)
  )];
}

function buildKalkulatorEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({ name: '🐈 Cat Shop 🐈 × Kalkulator Prowizji', iconURL: SS_SHOP_EMOJI_URL })
    .setThumbnail(SS_SHOP_EMOJI_URL)
    .setTitle('🐈 Kalkulator Prowizji — Cat Shop 🐈')
    .setDescription(
      '>>> Jeżeli chcesz obliczyć **prowizję swojej wymiany**, kliknij odpowiedni przycisk poniżej.\n' +
      'Wybór metody płatności oraz wpisanie kwoty odbywa się w wyskakującym okienku — **nikt inny tego nie zobaczy!**\n\n' +
      '🐈 Kliknij przycisk i postępuj zgodnie z instrukcjami!'
    )
    .addFields(
      { name: '🐈 Kurs wymiany', value: `1 zł = **${formatDolary(PRZELICZNIK)} $**`, inline: true },
      { name: '🐈 Dostępne metody płatności', value: Object.values(PROWIZJE).map(d => `${d.emoji} **${d.nazwa}** — \`${d.prowizja}%\` prowizji`).join('\n'), inline: false }
    )
    .setFooter({ text: 'Cat Shop | Kalkulator Prowizji 🐈' })
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

function buildMetodyEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({ name: '🐈 Cat Shop 🐈 × Metody Płatności', iconURL: SS_SHOP_EMOJI_URL })
    .setThumbnail(SS_SHOP_EMOJI_URL)
    .setTitle('🐈 Metody Płatności — Cat Shop 🐈')
    .setDescription('>>> Poniżej znajdziesz wszystkie dostępne metody płatności w **Cat Shop** wraz z prowizjami.')
    .addFields({
      name: '💳 Dostępne metody płatności',
      value:
        `<:blik:1505930944777818172> **Kod BLIK** — \`10%\` prowizji\n` +
        `📱 **BLIK na numer telefonu** — \`0%\` prowizji\n` +
        `<:PSC:1505930725109792999> **PSC z paragonem** — \`13%\` prowizji\n` +
        `<:PSC:1505930725109792999> **PSC bez paragonu** — \`20%\` prowizji\n` +
        `<:MYPSC:1505930776884281546> **MyPSC** — \`25%\` prowizji\n` +
        `<:LTC:1505930806840004830> **LTC (Litecoin)** — \`0%\` prowizji\n` +
        `<:BTC:1505930861495713922> **BTC (Bitcoin)** — \`0%\` prowizji\n` +
        `<:USDT:1505930988507762748> **USDT** — \`0%\` prowizji\n` +
        `<:USDC:1505930834429874327> **USDC** — \`0%\` prowizji\n` +
        `<:ether:1505930906957905972> **ETH (Ethereum)** — \`0%\` prowizji\n` +
        `<:PP:1505931011530297514> **PayPal** — \`13%\` prowizji\n`,
      inline: false
    })
    .setFooter({ text: 'Cat Shop | Metody Płatności 🐈' })
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

function buildPropozycjeMainEmbed() {
  return new EmbedBuilder()
    .setColor(0xFFFFFF)
    .setAuthor({ name: 'CatShop × PROPOZYCJE', iconURL: RAVEN_LOGO_URL })
    .setDescription(
      '>>> **»** Masz pomysł na ulepszenie serwera?\n' +
      '**»** Kliknij przycisk poniżej i **wystaw swoją propozycję**.\n' +
      '**»** Społeczność zagłosuje czy ją **przyjąć** ✅ czy **odrzucić** ❌.'
    )
    .setFooter({ text: 'CatShop © 2026' })
    .setTimestamp();
}

function buildPropozycjeComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('propozycja_wystaw').setLabel('💡 Wystaw propozycję').setStyle(ButtonStyle.Secondary)
  )];
}

async function sendOrUpdatePropozycje() {
  try {
    const channel = await client.channels.fetch(PROPOZYCJE_CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('❌ Nie znaleziono kanału propozycji'); return; }
    const embed      = buildPropozycjeMainEmbed();
    const components = buildPropozycjeComponents();
    const existingId = await getConfig(PROPOZYCJE_MSG_KEY);
    if (existingId) {
      try {
        const existing = await channel.messages.fetch(existingId);
        await existing.edit({ embeds: [embed], components });
        console.log('✅ Propozycje zaktualizowane!');
        return;
      } catch {}
    }
    const msg = await channel.send({ embeds: [embed], components });
    await setConfig(PROPOZYCJE_MSG_KEY, msg.id);
    console.log('✅ Propozycje wysłane!');
  } catch (err) {
    console.error('❌ Błąd propozycji:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ─── TICKET SYSTEM ───────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

const TICKET_CATEGORY_ID = '1505521873621094422';

const TICKET_PINGS = {
  premki:          ['<@965929399557976105>'],
  radar:           ['<@1215343846003576872>'],
  zakup_pieniedzy: ['<@&1505525726005428425>', '<@&1505525879928000582>', '<@&1505525907350229166>', '<@&1505525920922865765>', '<@&1505525934630109205>'],
  skup:            ['<@&1505525726005428425>', '<@&1505525879928000582>', '<@&1505525907350229166>', '<@&1505525920922865765>', '<@&1505525934630109205>'],
};

const TICKET_REP_CHANNEL = {
  premki:          '1505521873402855452',
  radar:           '1505532967500644412',
  zakup_pieniedzy: '1505521873402855452',
  skup:            '1505521873402855452',
};

const TICKET_NAMES = {
  premki:          'Premki',
  radar:           'Radar',
  zakup_pieniedzy: 'Zakup pieniędzy',
  skup:            'Skup',
};

const SELLER_ROLE_IDS = [
  '1505525726005428425',
  '1505525879928000582',
  '1505525907350229166',
  '1505525920922865765',
  '1505525934630109205',
];

const CATHUB_LOGO_URL = 'https://i.imgur.com/Y65cjjd.png';

async function sendTicketTranscript(channel, guild, closedBy, ownerId, kategoria, kwotaZl, kwotaDolary, sukces) {
  try {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;

    const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const lines = sorted.map(m => {
      const ts = new Date(m.createdTimestamp).toISOString();
      const content = m.content || (m.embeds.length ? '[EMBED]' : '[brak treści]');
      return `[${ts}] ${m.author.tag} (${m.author.id}): ${content}`;
    });

    const transcriptText =
      `=== TRANSCRIPT TICKETU ===\n` +
      `Kanał: #${channel.name} (${channel.id})\n` +
      `Kategoria: ${TICKET_NAMES[kategoria] || kategoria}\n` +
      `Właściciel: ${ownerId}\n` +
      `Zamknął: ${closedBy.tag} (${closedBy.id})\n` +
      `Transakcja pomyślna: ${sukces}\n` +
      `Kwota kupującego: ${kwotaZl}\n` +
      `Kwota otrzymana: ${kwotaDolary}\n` +
      `Zamknięto: ${new Date().toISOString()}\n` +
      `==========================\n\n` +
      lines.join('\n');

    const buffer = Buffer.from(transcriptText, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: `transcript-${channel.name}-${Date.now()}.txt` });

    const transcriptEmbed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setAuthor({ name: 'CatHub × Transcript Ticketu', iconURL: CATHUB_LOGO_URL })
      .setTitle(`📄 Transcript — ${TICKET_NAMES[kategoria] || kategoria}`)
      .addFields(
        { name: '📂 Kategoria',          value: TICKET_NAMES[kategoria] || kategoria, inline: true },
        { name: '👤 Właściciel ticketu', value: `<@${ownerId}>`,                      inline: true },
        { name: '🔒 Zamknął',            value: `<@${closedBy.id}>`,                  inline: true },
        { name: '✅ Transakcja',         value: sukces,                                inline: true },
        { name: '💵 Kwota kupującego',   value: kwotaZl,                              inline: true },
        { name: '💰 Kwota otrzymana',    value: kwotaDolary,                          inline: true },
        { name: '🕐 Zamknięto',         value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      )
      .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
      .setTimestamp();

    await logChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
  } catch (err) {
    console.error('❌ Błąd sendTicketTranscript:', err.message);
  }
}

function buildTicketSetupEmbed() {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({ name: '🐈 CatHub × System Ticketów', iconURL: CATHUB_LOGO_URL })
    .setThumbnail(CATHUB_LOGO_URL)
    .setTitle('🎫 Otwórz ticket')
    .setDescription(
      '>>> Wybierz kategorię swojego zgłoszenia klikając odpowiedni przycisk poniżej.\n\n' +
      '🏷️ **Premki** — zakup lub pomoc z premkami\n' +
      '📡 **Radar** — zakup lub pomoc z modem\n' +
      '💸 **Zakup pieniędzy** — Zakup pieniędzy\n' +
      '💰 **Skup** — Sprzedaz dolarów serwerowych'
    )
    .setFooter({ text: 'CatHub | Tickety', iconURL: CATHUB_LOGO_URL })
    .setTimestamp();
}

function buildTicketSetupComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_open_premki').setLabel('🏷️ Premki').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_open_radar').setLabel('📡 Radar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ticket_open_zakup_pieniedzy').setLabel('💸 Zakup pieniędzy').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_open_skup').setLabel('💰 Skup').setStyle(ButtonStyle.Success),
  )];
}

function buildTicketChannelEmbed(member, kategoria, metodaPlatnosci, kwotaZakupu) {
  return new EmbedBuilder()
    .setColor(0x6a00ff)
    .setAuthor({ name: `🐈 CatHub × Ticket | ${TICKET_NAMES[kategoria]}`, iconURL: CATHUB_LOGO_URL })
    .setThumbnail(CATHUB_LOGO_URL)
    .setTitle(`🎫 Ticket — ${TICKET_NAMES[kategoria]}`)
    .setDescription(
      `>>> Witaj <@${member.id}>!\n\n` +
      `Twój ticket w kategorii **${TICKET_NAMES[kategoria]}** został otwarty.\n` +
      `Obsługa zajmie się Tobą jak najszybciej. Prosimy o cierpliwość! 🐈`
    )
    .addFields(
      { name: '👤 Zgłaszający',      value: `<@${member.id}>`,      inline: true },
      { name: '📂 Kategoria',        value: TICKET_NAMES[kategoria], inline: true },
      { name: '\u200B',              value: '\u200B',                inline: true },
      { name: '💳 Metoda płatności', value: metodaPlatnosci,         inline: true },
      { name: '💰 Kwota zakupu',     value: kwotaZakupu,             inline: true },
      { name: '\u200B',              value: '\u200B',                inline: true },
      { name: '🕐 Otwarty',         value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
    )
    .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
    .setTimestamp();
}

function buildTicketActionComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('✋ Przejmij ticket').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger),
  )];
}

async function openTicket(interaction, kategoria) {
  try {
    const modal = new ModalBuilder()
      .setCustomId(`ticket_open_modal_${kategoria}`)
      .setTitle(`🎫 Otwórz ticket — ${TICKET_NAMES[kategoria] || kategoria}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('metoda_platnosci')
          .setLabel('Metoda płatności (np. BLIK, BTC, PayPal)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('np. BLIK na numer telefonu')
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('kwota_zakupu')
          .setLabel('Kwota zakupu (np. 50zł, 100k$)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('np. 50zł lub 365k')
          .setRequired(true)
          .setMaxLength(30)
      ),
    );

    await interaction.showModal(modal);
  } catch (err) {
    console.error('❌ Błąd openTicket:', err.message);
  }
}

async function openTicketWithDetails(interaction, kategoria, metodaPlatnosci, kwotaZakupu) {
  try {
    await interaction.deferReply({ flags: 64 });

    const guild  = interaction.guild;
    const member = interaction.member;

    const existing = guild.channels.cache.find(
      ch => ch.topic && ch.topic.startsWith(`ticket:${kategoria}:${member.id}`)
    );
    if (existing) {
      return interaction.editReply({ content: `❌ Masz już otwarty ticket w tej kategorii: <#${existing.id}>` });
    }

    const channelName = `ticket-${TICKET_NAMES[kategoria].toLowerCase().replace(/\s+/g, '-')}-${member.user.username}`.slice(0, 100);

    const permissionOverwrites = [
      { id: guild.id,            deny:  [PermissionsBitField.Flags.ViewChannel] },
      { id: member.id,           allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
    ];

    for (const rid of SELLER_ROLE_IDS) {
      permissionOverwrites.push({
        id: rid,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    }

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      topic: `ticket:${kategoria}:${member.id}`,
      permissionOverwrites,
    });

    const embed = buildTicketChannelEmbed(member, kategoria, metodaPlatnosci, kwotaZakupu);
    const pings = (TICKET_PINGS[kategoria] || []).join(' ');
    await ticketChannel.send({
      content: pings ? `${pings} <@${member.id}>` : `<@${member.id}>`,
      embeds:  [embed],
      components: buildTicketActionComponents(),
    });

    const logCh = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logCh) {
      await logCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0x6a00ff)
          .setAuthor({ name: 'CatHub × Ticket otwarty', iconURL: CATHUB_LOGO_URL })
          .addFields(
            { name: '📂 Kategoria', value: TICKET_NAMES[kategoria] || kategoria, inline: true },
            { name: '👤 Otworzył',  value: `<@${member.id}>`,                    inline: true },
            { name: '📌 Kanał',     value: `<#${ticketChannel.id}>`,             inline: true },
            { name: '🕐 Czas',      value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
          )
          .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
          .setTimestamp()]
      }).catch(() => {});
    }

    await interaction.editReply({ content: `✅ Ticket został otwarty: <#${ticketChannel.id}>` });
  } catch (err) {
    console.error('❌ Błąd openTicketWithDetails:', err.message);
    try { await interaction.editReply({ content: '❌ Wystąpił błąd podczas tworzenia ticketu.' }); } catch {}
  }
}

// ─── OBSŁUGA INTERAKCJI TICKET ────────────────────────────────────────────────
async function handleTicketInteraction(interaction) {

  // ── OTWÓRZ TICKET — przycisk ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ticket_open_')) {
    const kategoria = interaction.customId.replace('ticket_open_', '');
    await openTicket(interaction, kategoria);
    return true;
  }

  // ── OTWÓRZ TICKET — modal submit ───────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_open_modal_')) {
    const kategoria       = interaction.customId.replace('ticket_open_modal_', '');
    const metodaPlatnosci = interaction.fields.getTextInputValue('metoda_platnosci').trim();
    const kwotaZakupu     = interaction.fields.getTextInputValue('kwota_zakupu').trim();
    await openTicketWithDetails(interaction, kategoria, metodaPlatnosci, kwotaZakupu);
    return true;
  }

  // ── PRZEJMIJ TICKET ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'ticket_claim') {
    const channel = interaction.channel;
    const topic   = channel.topic || '';
    const [, kategoria, ownerId] = topic.split(':');

    const isSeller = SELLER_ROLE_IDS.some(rid => interaction.member.roles.cache.has(rid));
    const isAdmin  = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isSeller && !isAdmin) {
      await interaction.reply({ content: '❌ Nie masz uprawnień do przejmowania ticketów.', flags: 64 });
      return true;
    }

    const newOverwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id,  allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: interaction.guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] },
    ];
    if (ownerId) {
      newOverwrites.push({ id: ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    }
    for (const rid of SELLER_ROLE_IDS) {
      newOverwrites.push({ id: rid, deny: [PermissionsBitField.Flags.ViewChannel] });
    }

    await channel.permissionOverwrites.set(newOverwrites);

    const claimEmbed = new EmbedBuilder()
      .setColor(0x00cc88)
      .setAuthor({ name: 'CatHub × Ticket przejęty', iconURL: CATHUB_LOGO_URL })
      .setDescription(`✅ Ticket przejęty przez <@${interaction.user.id}>`)
      .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
      .setTimestamp();

    const newComponents = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('✋ Przejęty').setStyle(ButtonStyle.Primary).setDisabled(true),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Zamknij ticket').setStyle(ButtonStyle.Danger),
    )];

    await interaction.update({ components: newComponents });
    await channel.send({ embeds: [claimEmbed] });

    const logCh = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logCh) {
      await logCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0x00cc88)
          .setAuthor({ name: 'CatHub × Ticket przejęty', iconURL: CATHUB_LOGO_URL })
          .addFields(
            { name: '📌 Kanał',   value: `<#${channel.id}>`,              inline: true },
            { name: '✋ Przejął', value: `<@${interaction.user.id}>`,     inline: true },
            { name: '👤 Owner',   value: ownerId ? `<@${ownerId}>` : '?', inline: true },
            { name: '🕐 Czas',    value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
          )
          .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
          .setTimestamp()]
      }).catch(() => {});
    }

    return true;
  }

  // ── ZAMKNIJ TICKET — przycisk ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    const topic = interaction.channel.topic || '';
    const [, kategoria, ownerId] = topic.split(':');

    const isSeller = SELLER_ROLE_IDS.some(rid => interaction.member.roles.cache.has(rid));
    const isAdmin  = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isOwner  = interaction.user.id === ownerId;

    if (!isSeller && !isAdmin && !isOwner) {
      await interaction.reply({ content: '❌ Nie masz uprawnień do zamknięcia tego ticketu.', flags: 64 });
      return true;
    }

    if (isSeller || isAdmin) {
      const modal = new ModalBuilder()
        .setCustomId(`ticket_close_modal_${kategoria || 'unknown'}`)
        .setTitle('📋 Podsumowanie transakcji');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('transakcja_sukces')
            .setLabel('Transakcja pomyślna? (Tak/Nie)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Tak / Nie')
            .setRequired(true)
            .setMaxLength(3)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('kwota_zl')
            .setLabel('Jaką kwotę wydał kupujący? (np. 50zł)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. 50zł')
            .setRequired(true)
            .setMaxLength(20)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('kwota_dolary')
            .setLabel('Jaką kwotę otrzymał kupujący? (np. 365k)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('np. 365k, 1m')
            .setRequired(true)
            .setMaxLength(20)
        ),
      );

      await interaction.showModal(modal);
      return true;
    }

    await interaction.reply({ content: '⚠️ Ticket zostanie zamknięty przez obsługę po zakończeniu transakcji.', flags: 64 });
    return true;
  }

  // ── ZAMKNIJ TICKET — modal submit ─────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_close_modal_')) {
    const kategoria    = interaction.customId.replace('ticket_close_modal_', '');
    const channel      = interaction.channel;
    const topic        = channel.topic || '';
    const [,, ownerId] = topic.split(':');

    const sukces      = interaction.fields.getTextInputValue('transakcja_sukces').trim();
    const kwotaZl     = interaction.fields.getTextInputValue('kwota_zl').trim();
    const kwotaDolary = interaction.fields.getTextInputValue('kwota_dolary').trim();
    const seller      = interaction.user;

    const repChannelId   = TICKET_REP_CHANNEL[kategoria] || TICKET_REP_CHANNEL['zakup_pieniedzy'];
    const nazwaKategorii = TICKET_NAMES[kategoria] || kategoria;
    const repText        = `+rep <@${seller.id}> ${nazwaKategorii} anarchia.gg ${kwotaZl} ${kwotaDolary}`;

    const summaryEmbed = new EmbedBuilder()
      .setColor(sukces.toLowerCase() === 'tak' ? 0x00cc88 : 0xff4444)
      .setAuthor({ name: 'CatHub × Podsumowanie transakcji', iconURL: CATHUB_LOGO_URL })
      .setTitle('📋 Podsumowanie transakcji')
      .addFields(
        { name: '✅ Transakcja pomyślna', value: sukces,       inline: true },
        { name: '💵 Kwota kupującego',    value: kwotaZl,      inline: true },
        { name: '💰 Kwota otrzymana',     value: kwotaDolary,  inline: true },
        { name: '👤 Obsługujący',         value: `<@${seller.id}>`, inline: false },
        { name: '🕐 Zamknięto',           value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      )
      .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
      .setTimestamp();

    const repEmbed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setAuthor({ name: 'CatHub × Wystaw +rep', iconURL: CATHUB_LOGO_URL })
      .setDescription(
        `🌟 **Dziękujemy za zakup!**\n\n` +
        `Prosimy o wystawienie opinii na kanale <#${repChannelId}>.\n\n` +
        `Skopiuj poniższy tekst i wklej na kanale opinii:\n` +
        `\`\`\`${repText}\`\`\``
      )
      .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
      .setTimestamp();

    await interaction.reply({ embeds: [summaryEmbed, repEmbed] });

    await sendTicketTranscript(channel, interaction.guild, seller, ownerId, kategoria, kwotaZl, kwotaDolary, sukces);

    if (sukces.toLowerCase() !== 'tak') {
      await channel.delete('Transakcja nieudana — ticket zamknięty').catch(err => {
        console.error('❌ Błąd usuwania kanału (nieudana transakcja):', err.message);
      });
      return true;
    }

    const repChannelIdFinal = repChannelId;
    const ownerId_final     = ownerId;
    const repTextFinal      = repText;
    const guild             = interaction.guild;
    const MAX_WAIT_MS       = 15 * 60 * 1000;
    const CHECK_INTERVAL_MS = 20 * 1000;
    const startWait         = Date.now();

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xffcc00)
        .setAuthor({ name: 'CatHub × Oczekiwanie na +rep', iconURL: CATHUB_LOGO_URL })
        .setDescription(
          `⏳ Ticket zostanie **automatycznie zamknięty** gdy bot wykryje \`+rep\` na kanale <#${repChannelIdFinal}>.\n\n` +
          `Jeśli +rep nie zostanie wystawiony w ciągu **15 minut**, ticket zamknie się automatycznie.`
        )
        .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
        .setTimestamp()]
    }).catch(() => {});

    const autoRepTimer = setTimeout(async () => {
      try {
        const repCh = await client.channels.fetch(repChannelIdFinal).catch(() => null);
        if (!repCh) return;

        const msgs = await repCh.messages.fetch({ limit: 50 }).catch(() => null);
        if (msgs) {
          const alreadyRepped = msgs.some(m =>
            m.author.id === ownerId_final &&
            m.content.includes('+rep') &&
            m.createdTimestamp >= startWait
          );
          if (alreadyRepped) return;
        }

        const ownerMember = await guild.members.fetch(ownerId_final).catch(() => null);
        if (!ownerMember) return;

        const avatarURL   = ownerMember.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
        const displayName = ownerMember.displayName;

        const webhook = await repCh.createWebhook({
          name: displayName,
          avatar: avatarURL,
          reason: 'Auto +rep za użytkownika'
        }).catch(() => null);
        if (!webhook) return;

        await webhook.send({ content: repTextFinal });
        await webhook.delete().catch(() => {});
      } catch (err) {
        console.error('❌ Błąd auto +rep:', err.message);
      }
    }, 10 * 60 * 1000);

    const pollInterval = setInterval(async () => {
      try {
        const elapsed = Date.now() - startWait;

        const repCh = await client.channels.fetch(repChannelIdFinal).catch(() => null);
        let repFound = false;

        if (repCh) {
          const msgs = await repCh.messages.fetch({ limit: 50 }).catch(() => null);
          if (msgs) {
            repFound = msgs.some(m =>
              (m.author.id === ownerId_final || m.webhookId) &&
              m.content.toLowerCase().includes('+rep') &&
              m.createdTimestamp >= startWait
            );
          }
        }

        const shouldClose = repFound || elapsed >= MAX_WAIT_MS;

        if (shouldClose) {
          clearInterval(pollInterval);
          clearTimeout(autoRepTimer);

          const reason = repFound
            ? '✅ +rep wykryty — ticket zamknięty!'
            : '⏰ Limit czasu minął — ticket zamknięty automatycznie.';

          try {
            await channel.send({
              embeds: [new EmbedBuilder()
                .setColor(repFound ? 0x00cc88 : 0xff8800)
                .setDescription(reason)
                .setFooter({ text: 'CatHub | System Ticketów', iconURL: CATHUB_LOGO_URL })
                .setTimestamp()]
            });
          } catch {}

          await new Promise(r => setTimeout(r, 4000));
          await channel.delete(`Ticket zamknięty: ${reason}`).catch(err => {
            console.error('❌ Błąd usuwania kanału:', err.message);
          });
        }
      } catch (err) {
        console.error('❌ Błąd pollInterval ticket close:', err.message);
        clearInterval(pollInterval);
        clearTimeout(autoRepTimer);
        await new Promise(r => setTimeout(r, 4000));
        await channel.delete().catch(() => {});
      }
    }, CHECK_INTERVAL_MS);

    return true;
  }

  return false;
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
  await sendOrUpdateMetody();
  await sendOrUpdatePropozycje();

  try {
    const startGuild = client.guilds.cache.get(GUILD_ID);
    if (startGuild) {
      const fetched = await startGuild.invites.fetch();
      client.inviteCache = new Map(fetched.map(inv => [inv.code, inv.uses]));
    }
  } catch (err) {
    console.error('❌ Błąd cache zaproszeń:', err.message);
    client.inviteCache = new Map();
  }

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) await updateMemberCount(guild);

  if (guild) {
    const alreadyReset1 = await getConfig('legit_check_reset_done');
    if (!alreadyReset1) {
      await setConfig(LEGIT_CHECK_COUNT_KEY, '0');
      await updateLegitCheckCount(guild, 0);
      await setConfig('legit_check_reset_done', '1');
      console.log('✅ Legit check radar zresetowany do 0 (jednorazowo)');
    } else {
      const raw = await getConfig(LEGIT_CHECK_COUNT_KEY);
      await updateLegitCheckCount(guild, raw ? parseInt(raw) : 0);
    }
  }

  if (guild) {
    const alreadyReset2 = await getConfig('legit_check2_reset_done');
    if (!alreadyReset2) {
      await setConfig(LEGIT_CHECK2_COUNT_KEY, '24');
      await updateLegitCheck2Count(guild, 24);
      await setConfig('legit_check2_reset_done', '1');
      console.log('✅ Legit check 2 zresetowany do 24 (jednorazowo)');
    } else {
      const raw2 = await getConfig(LEGIT_CHECK2_COUNT_KEY);
      await updateLegitCheck2Count(guild, raw2 ? parseInt(raw2) : 24);
    }
  }

  setInterval(async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;
      const members = await guild.members.fetch({ withPresences: true }).catch(() => null);
      if (!members) return;
      for (const [, member] of members) {
        if (member.user.bot) continue;
        const presence = member.presence;
        const isOffline = !presence || presence.status === 'offline' || presence.status === 'invisible';
        if (isOffline) continue;
        await checkAndUpdateAutoRole(member);
      }
    } catch (err) {
      console.error('❌ Błąd interwału auto-roli:', err.message);
    }
  }, 30 * 1000);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== GUILD_ID) return;
    await checkAndUpdateAutoRole(newMember);
  } catch (err) {
    console.error('❌ Błąd guildMemberUpdate:', err.message);
  }
});

const DISCORD_LINK_REGEX = /(discord\.gg\/|discord\.com\/invite\/|dsc\.gg\/)/i;

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.channel.id === LEGIT_CHECK_CHANNEL_ID) {
    try {
      const raw   = await getConfig(LEGIT_CHECK_COUNT_KEY);
      const count = (raw ? parseInt(raw) : 0) + 1;
      await setConfig(LEGIT_CHECK_COUNT_KEY, String(count));
      await updateLegitCheckCount(message.guild, count);
    } catch (err) {
      console.error('❌ Błąd legit check count:', err.message);
    }
  }

  if (message.channel.id === LEGIT_CHECK2_CHANNEL_ID) {
    try {
      const raw2   = await getConfig(LEGIT_CHECK2_COUNT_KEY);
      const count2 = (raw2 ? parseInt(raw2) : 24) + 1;
      await setConfig(LEGIT_CHECK2_COUNT_KEY, String(count2));
      await updateLegitCheck2Count(message.guild, count2);
    } catch (err) {
      console.error('❌ Błąd legit check 2 count:', err.message);
    }
  }

  if (message.channel.id === DROP_CHANNEL_ID) {
    await message.delete().catch(() => {});
    return;
  }

  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  if (message.guild.ownerId === message.author.id) return;
  if (!DISCORD_LINK_REGEX.test(message.content)) return;

  try {
    await message.delete();
    await message.author.send('🚫 **Nie wysyłaj linków do żadnego discorda!**\nZa karę dostajesz przerwę na **7 dni**. Przemyśl sobie co zrobiłeś.').catch(() => {});
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
          .setFooter({ text: 'Cat Shop | System anty-link' })]
      });
    }
  } catch (err) {
    console.error('❌ Błąd anti-invite:', err.message);
  }
});

client.on('interactionCreate', async interaction => {
  const ticketHandled = await handleTicketInteraction(interaction);
  if (ticketHandled) return;

  // ── PROPOZYCJE ────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'propozycja_wystaw') {
    const modal = new ModalBuilder().setCustomId('propozycja_modal').setTitle('💡 Dodaj propozycję');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('propozycja_tresc')
        .setLabel('OPIS PROPOZYCJI')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Napisz swoją propozycję...')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(500)
    ));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'propozycja_modal') {
    await interaction.deferReply({ flags: 64 });
    const tresc = interaction.fields.getTextInputValue('propozycja_tresc').trim();
    const user  = interaction.user;
    const propEmbed = new EmbedBuilder()
      .setColor(0xFFFFFF)
      .setAuthor({ name: 'Cat Shop × PROPOZYCJA', iconURL: SS_SHOP_EMOJI_URL })
      .setDescription('> 👤 <@' + user.id + '>\n> 💡 *' + tresc + '*')
      .setFooter({ text: 'Cat Shop © 2026', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    try {
      const channel = await client.channels.fetch(PROPOZYCJE_CHANNEL_ID).catch(() => null);
      if (channel) {
        const existingId = await getConfig(PROPOZYCJE_MSG_KEY);
        if (existingId) {
          try { const existingMsg = await channel.messages.fetch(existingId); await existingMsg.delete(); } catch {}
          await setConfig(PROPOZYCJE_MSG_KEY, null);
        }
        const sent = await channel.send({ embeds: [propEmbed] });
        await sent.react('✅');
        await sent.react('❌');
        const newMainMsg = await channel.send({ embeds: [buildPropozycjeMainEmbed()], components: buildPropozycjeComponents() });
        await setConfig(PROPOZYCJE_MSG_KEY, newMainMsg.id);
      }
    } catch (err) {
      console.error('❌ Błąd wysyłania propozycji:', err.message);
    }
    await interaction.editReply({ content: '✅ **Twoja propozycja została wysłana!** Społeczność może teraz na nią głosować.' });
    return;
  }

  // ── DROP ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'drop') {
    if (interaction.channel.id !== DROP_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${DROP_CHANNEL_ID}>!`, flags: 64 });
    }
    const hasRole = interaction.member.roles.cache.has(DROP_REQUIRED_ROLE);
    if (!hasRole) {
      const errEmbed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setAuthor({ name: 'CatShop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 CatShop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          { name: '👤 Użytkownik',   value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
          { name: '🆔 ID',           value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B',          value: '\u200B', inline: true },
          { name: '❌ Brak dostępu', value: 'Nie masz wymaganej rangi do użycia tej komendy!', inline: false }
        )
        .setFooter({ text: 'CatShop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [errEmbed] });
    }

    const dropData  = await getDropData(interaction.user.id);
    const now       = Date.now();
    const remaining = DROP_COOLDOWN_MS - (now - dropData.last_drop);

    if (remaining > 0) {
      const embed = new EmbedBuilder()
        .setColor(0xff4444)
        .setAuthor({ name: 'CatShop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 CatShop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          { name: '👤 Użytkownik',  value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
          { name: '🆔 ID',          value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B',         value: '\u200B', inline: true },
          { name: '❌ Wynik',        value: 'Masz Cooldown! — poczekaj 2h!', inline: false },
          { name: '⏳ Dostępny za', value: `<t:${Math.floor((dropData.last_drop + DROP_COOLDOWN_MS) / 1000)}:R>`, inline: false }
        )
        .setFooter({ text: 'CatShop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const nagroda = losujNagrode();

    if (!nagroda) {
      await saveDropData(interaction.user.id, now, dropData.nagrody);
      await logDropResult(interaction, null);
      const embed = new EmbedBuilder()
        .setColor(0x2B2D31)
        .setAuthor({ name: 'CatShop × DROP', iconURL: SS_SHOP_EMOJI_URL })
        .setTitle('🎁 CatShop × DROP')
        .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .addFields(
          { name: '👤 Użytkownik',    value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
          { name: '🆔 ID',            value: `\`${interaction.user.id}\``, inline: true },
          { name: '\u200B',           value: '\u200B', inline: true },
          { name: '❌ Wynik',          value: 'Tym razem nic się nie trafiło. Spróbuj za 2 godziny!', inline: false },
          { name: '⏳ Następny drop', value: `<t:${Math.floor((now + DROP_COOLDOWN_MS) / 1000)}:R>`, inline: false }
        )
        .setFooter({ text: 'CatShop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    dropData.nagrody.push(nagroda.nazwa);
    await saveDropData(interaction.user.id, now, dropData.nagrody);
    await logDropResult(interaction, nagroda);

    const embedWin = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setAuthor({ name: 'CatShop × DROP', iconURL: SS_SHOP_EMOJI_URL })
      .setTitle('🎁 CatShop × DROP')
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .addFields(
        { name: '👤 Użytkownik',    value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
        { name: '🆔 ID',            value: `\`${interaction.user.id}\``, inline: true },
        { name: '\u200B',           value: '\u200B', inline: true },
        { name: '🎉 Nagroda',       value: `${nagroda.emoji} **${nagroda.nazwa}**`, inline: true },
        { name: '⏳ Następny drop', value: `<t:${Math.floor((now + DROP_COOLDOWN_MS) / 1000)}:R>`, inline: true },
        { name: '\u200B',           value: '\u200B', inline: true }
      )
      .setFooter({ text: 'CatShop • Drop System', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    return interaction.reply({ embeds: [embedWin] });
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

  // ── KALKULATOR: ile dostanę ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_dostane') {
    await interaction.reply({ content: '🐈 **Krok 1 z 2** — Wybierz metodę płatności:', components: [buildSelectMenuRow('select_ile_dostane')], flags: 64 });
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
    const metodaKey      = interaction.customId.replace('modal_ile_dostane_', '');
    const metoda         = PROWIZJE[metodaKey];
    const kwotaZl        = parseZloty(interaction.fields.getTextInputValue('kwota_zl'));
    if (!kwotaZl) {
      await interaction.reply({ content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`zł\` na końcu, np. \`10zł\`.`, flags: 64 });
      return;
    }
    const po_prowizji_zl = kwotaZl * (1 - metoda.prowizja / 100);
    const prowizja_zl    = kwotaZl - po_prowizji_zl;
    const dolary         = po_prowizji_zl * PRZELICZNIK;
    await interaction.reply({
      content:
        `🐈 **Wynik kalkulatora Cat Shop:**\n\n` +
        `${metoda.emoji} Metoda: **${metoda.nazwa}**\n` +
        `💵 Wysyłasz: **${kwotaZl.toFixed(2)} zł**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **-${prowizja_zl.toFixed(2)} zł**\n` +
        `🐈 Dolary serwerowe, które otrzymasz: **${formatDolary(dolary)} $**`,
      flags: 64
    });
    return;
  }

  // ── KALKULATOR: ile zapłacić ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_zaplacic') {
    await interaction.reply({ content: '🐈 **Krok 1 z 2** — Wybierz metodę płatności:', components: [buildSelectMenuRow('select_ile_zaplacic')], flags: 64 });
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
    const metodaKey  = interaction.customId.replace('modal_ile_zaplacic_', '');
    const metoda     = PROWIZJE[metodaKey];
    const dolary     = parseDolary(interaction.fields.getTextInputValue('kwota_dolary'));
    if (!dolary) {
      await interaction.reply({ content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`k\` lub \`m\`, np. \`80k\`, \`1m\`.`, flags: 64 });
      return;
    }
    const bazowa_cena_zl = dolary / PRZELICZNIK;
    const do_zaplaty_zl  = bazowa_cena_zl / (1 - metoda.prowizja / 100);
    const prowizja_zl    = do_zaplaty_zl - bazowa_cena_zl;
    await interaction.reply({
      content:
        `🐈 **Wynik kalkulatora Cat Shop:**\n\n` +
        `${metoda.emoji} Metoda: **${metoda.nazwa}**\n` +
        `🐈 Chcesz otrzymać: **${formatDolary(dolary)} $**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **+${prowizja_zl.toFixed(2)} zł**\n` +
        `💵 Musisz zapłacić łącznie: **${do_zaplaty_zl.toFixed(2)} zł**`,
      flags: 64
    });
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

  // ── SETUP-VERIFY ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', flags: 64 });
    }
    const embed = new EmbedBuilder()
      .setColor('#6a00ff')
      .setAuthor({ name: '🐈 Cat | Shop 🐈 × Weryfikacja', iconURL: SS_SHOP_EMOJI_URL })
      .setThumbnail(SS_SHOP_EMOJI_URL)
      .setDescription(
        '>>> Aby uzyskać pełny dostęp do serwera **Cat Shop**, musisz przejść proces weryfikacji.\n' +
        'Kliknij przycisk poniżej, aby połączyć swoje konto i uzyskać dostęp do kanałów!'
      )
      .setImage(SS_SHOP_EMOJI_URL);
    await interaction.channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify').setLabel('✅ Zweryfikuj się').setStyle(ButtonStyle.Success)
      )]
    });
    await interaction.reply({ content: '✅ Wiadomość weryfikacyjna wysłana!', flags: 64 });
    return;
  }

  // ── SETUP-VERIFY-MATH ─────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify-math') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', flags: 64 });
    }
    const embed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setDescription(
        '> Nie chcesz weryfikować się przez bota?\n' +
        '> Kliknij przycisk poniżej i rozwiąż krótkie zadanie matematyczne.'
      )
      .setFooter({ text: 'Cat Shop | Weryfikacja alternatywna' });
    await interaction.channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify_math').setLabel('🔢 Zweryfikuj się').setStyle(ButtonStyle.Secondary)
      )]
    });
    await interaction.reply({ content: '✅ Wysłano!', flags: 64 });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', flags: 64 });
    }
    await interaction.channel.send({ embeds: [buildTicketSetupEmbed()], components: buildTicketSetupComponents() });
    await interaction.reply({ content: '✅ Panel ticketów wysłany!', flags: 64 });
    return;
  }

  // ── VERIFY MATH: przycisk ─────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'verify_math') {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const ops = ['+', '-', '*'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let answer;
    if (op === '+') answer = a + b;
    if (op === '-') answer = a - b;
    if (op === '*') answer = a * b;
    const modal = new ModalBuilder()
      .setCustomId(`verify_math_modal_${answer}`)
      .setTitle('🔢 Weryfikacja matematyczna');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('math_answer')
        .setLabel(`Ile wynosi ${a} ${op} ${b}?`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz wynik...')
        .setRequired(true)
        .setMaxLength(10)
    ));
    await interaction.showModal(modal);
    return;
  }

  // ── VERIFY MATH: modal ────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('verify_math_modal_')) {
    const correctAnswer = parseInt(interaction.customId.replace('verify_math_modal_', ''));
    const userAnswer = parseInt(interaction.fields.getTextInputValue('math_answer').trim());
    if (isNaN(userAnswer) || userAnswer !== correctAnswer) {
      await interaction.reply({ content: '❌ Zła odpowiedź! Spróbuj ponownie.', flags: 64 });
      return;
    }
    try {
      if (interaction.member.roles.cache.has(ROLE_ID)) {
        await interaction.reply({ content: '✅ Jesteś już zweryfikowany!', flags: 64 });
        return;
      }
      await interaction.member.roles.add(ROLE_ID);
      const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        await logChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x6a00ff)
            .setTitle('✅ Weryfikacja matematyczna')
            .addFields(
              { name: '👤 Użytkownik', value: `${interaction.user.globalName || interaction.user.username} (\`${interaction.user.username}\`)`, inline: true },
              { name: '🆔 ID',         value: `\`${interaction.user.id}\``, inline: true },
              { name: '🕐 Czas',       value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setFooter({ text: 'Cat Shop | Weryfikacja matematyczna' })
            .setTimestamp()]
        });
      }
      await interaction.reply({ content: '✅ Poprawna odpowiedź! Ranga została nadana.', flags: 64 });
    } catch (err) {
      console.error('❌ Błąd weryfikacji matematycznej:', err.message);
      await interaction.reply({ content: '❌ Wystąpił błąd. Spróbuj ponownie.', flags: 64 });
    }
    return;
  }

  // ── TRANSFER ──────────────────────────────────────────────────────────────
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
          if (!accessToken) { deauthorized++; return; }
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
                if (member) { await member.roles.add(TRANSFER_ROLE_ID); }
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

  // ── ZAPROSZENIA MOJE ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'zaproszeniamoje') {
    if (interaction.channel.id !== INVITES_CMD_CHANNEL_ID) {
      return interaction.reply({ content: `❌ Tej komendy możesz użyć tylko na <#${INVITES_CMD_CHANNEL_ID}>!`, flags: 64 });
    }
    const count = await getInviteCount(interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setAuthor({ name: 'Cat Shop × Zaproszenia', iconURL: SS_SHOP_EMOJI_URL })
      .setThumbnail(interaction.user.displayAvatarURL({ extension: 'png', size: 256 }))
      .setTitle('🎟️ Twoje zaproszenia')
      .addFields(
        { name: '👤 Użytkownik',   value: `<@${interaction.user.id}>`, inline: true },
        { name: '🎟️ Zaproszenia', value: `**${count}**`,              inline: true }
      )
      .setFooter({ text: 'Cat Shop | System zaproszeń', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: 64 });
  }
});

client.on('guildMemberAdd', async member => {
  if (member.guild.id !== GUILD_ID) return;

  await updateMemberCount(member.guild);
  checkAndUpdateAutoRole(member).catch(() => {});

  const welcomeChannel = await client.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
  let welcomeMsg = null;
  if (welcomeChannel) {
    const randomGif = getRandomGif();
    const embedNatychmiast = new EmbedBuilder()
      .setColor(0x6a00ff)
      .setTitle(`💸Witaj na serwerze, **${member.user.username}**!💸`)
      .setDescription(
        `🐈 Cieszymy się, że dołączyłeś do **Cat Shop**! 🐈\n` +
        `🐈 Zweryfikuj się i sprawdź naszą ofertę! 🐈\n\n` +
        `👤 **Zaproszony przez:** szukam...`
      )
      .setThumbnail(randomGif)
      .setFooter({ text: 'Cat Shop | Witamy!', iconURL: SS_SHOP_EMOJI_URL })
      .setTimestamp();
    welcomeMsg = await welcomeChannel.send({ content: `<@${member.user.id}>`, embeds: [embedNatychmiast] }).catch(() => null);
  }

  (async () => {
    try {
      const newInvites = await member.guild.invites.fetch();
      const oldCache = client.inviteCache instanceof Map ? client.inviteCache : new Map();

      let inviter = null;
      let inviterCount = 0;

      for (const [code, invite] of newInvites) {
        const oldUses = oldCache.get(code) ?? 0;
        if (invite.uses > oldUses && invite.inviter) {
          inviter = invite.inviter;
          break;
        }
      }

      client.inviteCache = new Map(newInvites.map(inv => [inv.code, inv.uses]));

      if (inviter) {
        inviterCount = await incrementInviteCount(inviter.id);
      }

      if (welcomeMsg) {
        const randomGif = getRandomGif();
        let desc =
          `🐈 Cieszymy się, że dołączyłeś do **Cat Shop**! 🐈\n` +
          `🐈 Zweryfikuj się i sprawdź naszą ofertę! 🐈\n\n`;
        if (inviter) {
          desc += `👤 **Zaproszony przez:** <@${inviter.id}>\n`;
          desc += `🎟️ **Zaproszenia <@${inviter.id}>:** **${inviterCount}**`;
        } else {
          desc += `👤 **Zaproszony przez:** nieznany`;
        }
        const embedFinal = new EmbedBuilder()
          .setColor(0x6a00ff)
          .setTitle(`💸Witaj na serwerze, **${member.user.username}**!💸`)
          .setDescription(desc)
          .setThumbnail(randomGif)
          .setFooter({ text: 'Cat Shop | Witamy!', iconURL: SS_SHOP_EMOJI_URL })
          .setTimestamp();
        await welcomeMsg.edit({ embeds: [embedFinal] }).catch(() => {});
      }
    } catch (err) {
      console.error('❌ Błąd invite detect:', err.message);
    }
  })();
});

client.on('guildMemberRemove', async member => {
  if (member.guild.id !== GUILD_ID) return;
  await updateMemberCount(member.guild);
});

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

process.on('unhandledRejection', err => {
  console.error('❌ Unhandled rejection:', err?.message || err);
});

client.login(BOT_TOKEN);

// ─── REJESTRACJA KOMEND ───────────────────────────────────────────────────────
if (process.argv.includes('--setup')) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder().setName('drop').setDescription('🎁 Wylosuj nagrodę w CatShop!').toJSON(),
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
    new SlashCommandBuilder().setName('setup-verify').setDescription('Wysyła wiadomość weryfikacyjną z przyciskiem').toJSON(),
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
      .toJSON(),
    new SlashCommandBuilder().setName('setup-verify-math').setDescription('Wysyła alternatywną weryfikację matematyczną').toJSON(),
    new SlashCommandBuilder().setName('zaproszeniamoje').setDescription('🎟️ Sprawdź ile masz zaproszeń').toJSON(),
    new SlashCommandBuilder().setName('setup-tickets').setDescription('Wysyła panel ticketów').toJSON(),
  ];
  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    .then(() => { console.log('✅ Komendy zarejestrowane!'); process.exit(0); })
    .catch(err => { console.error('❌ Błąd rejestracji komend:', err); process.exit(1); });
}

// ─── SERWER HTTP ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bot działa!'));

app.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).send('❌ Brak kodu autoryzacji lub ID użytkownika.');

  if (usedCodes.has(code)) {
    return res.status(400).send('❌ Ten kod weryfikacyjny został już użyty. Wróć na Discord i kliknij przycisk ponownie.');
  }
  usedCodes.add(code);
  setTimeout(() => usedCodes.delete(code), 60_000);

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
          .setFooter({ text: 'Cat Shop | System weryfikacji' })
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
    usedCodes.delete(code);
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

app.listen(PORT, () => {
  console.log(`✅ Serwer HTTP działa na porcie ${PORT}`);
});
