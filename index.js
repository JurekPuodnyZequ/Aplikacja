require('dotenv').config();
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
  PermissionsBitField
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

const LOG_CHANNEL_ID = '1495432512506429465';
const KALKULATOR_CHANNEL_ID = '1498340002323628164';
const KALKULATOR_MSG_KEY = 'kalkulator_message_id';

// ─── KONFIGURACJA PRZELICZNIKA ────────────────────────────────────────────────
const PRZELICZNIK = 8000; // 1 zł = 8000$

// ─── BAZA DANYCH ───────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:ooqqGeeYDMypYAkQVxqJTNBstkLreIzr@postgres.railway.internal:5432/railway',
  ssl: false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      global_name TEXT,
      avatar TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at BIGINT,
      authorized_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  console.log('✅ Baza danych gotowa!');
}

async function saveUser(userData) {
  await pool.query(`
    INSERT INTO users (user_id, username, global_name, avatar, access_token, refresh_token, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO UPDATE SET
      username = $2,
      global_name = $3,
      avatar = $4,
      access_token = $5,
      refresh_token = $6,
      expires_at = $7,
      authorized_at = NOW()
  `, [
    userData.user_id,
    userData.username,
    userData.global_name,
    userData.avatar,
    userData.access_token,
    userData.refresh_token,
    userData.expires_at
  ]);
}

async function getConfig(key) {
  const res = await pool.query('SELECT value FROM bot_config WHERE key = $1', [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setConfig(key, value) {
  await pool.query(`
    INSERT INTO bot_config (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2
  `, [key, value]);
}

async function refreshAccessToken(userId) {
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  if (user.expires_at > Date.now() + 600000) {
    return user.access_token;
  }

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: user.refresh_token
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const newAccessToken = tokenRes.data.access_token;
    const newRefreshToken = tokenRes.data.refresh_token;
    const expiresAt = Date.now() + tokenRes.data.expires_in * 1000;

    await pool.query(`
      UPDATE users SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE user_id = $4
    `, [newAccessToken, newRefreshToken, expiresAt, userId]);

    return newAccessToken;
  } catch (err) {
    console.error(`❌ Nie udało się odświeżyć tokenu dla ${userId}:`, err?.response?.data || err.message);
    return null;
  }
}

// ─── KALKULATOR PROWIZJI ───────────────────────────────────────────────────────

const PROWIZJE = {
  'blik_telefon': { nazwa: 'BLIK na numer telefonu', prowizja: 0,  emoji: '📱' },
  'blik_kod':     { nazwa: 'Kod BLIK',               prowizja: 2,  emoji: '<:blik:1498356421262053386>' },
  'btc':          { nazwa: 'BTC (Bitcoin)',           prowizja: 7,  emoji: '<:btc:1498356295408029807>' },
  'ltc':          { nazwa: 'LTC (Litecoin)',          prowizja: 7,  emoji: '<:ltc:1498356372339818747>' },
  'usdt':         { nazwa: 'USDT',                   prowizja: 7,  emoji: '<:usdt:1498356339053822102>' },
  'usdc':         { nazwa: 'USDC',                   prowizja: 7,  emoji: '<:usdc:1498356270498054264>' },
  'eth':          { nazwa: 'ETH (Ethereum)',          prowizja: 7,  emoji: '<:eth:1498008998299959397>' },
  'paypal':       { nazwa: 'PayPal',                 prowizja: 13, emoji: '<:paypal:1498357795433746653>' },
  'psc_paragon':  { nazwa: 'PSC z paragonem',        prowizja: 13, emoji: '<:psc:1498356914013339705>' },
  'psc_bez':      { nazwa: 'PSC bez paragonu',       prowizja: 20, emoji: '<:psc:1498356914013339705>' },
  'mypsc':        { nazwa: 'MyPSC (tylko)',          prowizja: 25, emoji: '<:mypsc:1498356473153978450>' },
};

// Pomocnik: parsowanie kwoty w zł (musi kończyć się na "zł")
function parseZloty(input) {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith('zł') && !lower.endsWith('zl')) return null;
  const numStr = lower.replace(/zł|zl/, '').trim().replace(',', '.');
  const val = parseFloat(numStr);
  if (isNaN(val) || val <= 0) return null;
  return val;
}

// Pomocnik: parsowanie kwoty w dolarach serwerowych (musi mieć k lub m)
function parseDolary(input) {
  const trimmed = input.trim().toLowerCase().replace(',', '.');
  if (trimmed.endsWith('m')) {
    const val = parseFloat(trimmed.slice(0, -1));
    if (isNaN(val) || val <= 0) return null;
    return val * 1_000_000;
  }
  if (trimmed.endsWith('k')) {
    const val = parseFloat(trimmed.slice(0, -1));
    if (isNaN(val) || val <= 0) return null;
    return val * 1_000;
  }
  // Obsługa samej liczby jeśli użytkownik zapomni k/m
  const val = parseFloat(trimmed);
  if (!isNaN(val) && val > 0) return val;
  return null;
}

// Formatowanie liczby z k/m
function formatDolary(val) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2).replace(/\.00$/, '')}m`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2).replace(/\.00$/, '')}k`;
  return val.toLocaleString('pl-PL');
}

function buildSelectMenuRow(customId) {
  const options = Object.entries(PROWIZJE).map(([value, data]) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(`${data.nazwa} — ${data.prowizja}% prowizji`)
      .setValue(value);

    // Własne emoji z ID vs unicode
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
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('kalkulator_ile_dostane')
      .setLabel('💰 Ile dolarów serwerowych dostanę?')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('kalkulator_ile_zaplacic')
      .setLabel('💸 Ile zapłacić za tyle dolarów serwerowych?')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row];
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
      {
        name: '💜 Kurs wymiany',
        value: `1 zł = **${formatDolary(PRZELICZNIK)} $**`,
        inline: true
      },
      {
        name: '💜 Dostępne metody płatności',
        value: Object.values(PROWIZJE).map(d => `${d.emoji} **${d.nazwa}** — \`${d.prowizja}%\` prowizji`).join('\n'),
        inline: false
      }
    )
    .setFooter({ text: 'SS Shop | Kalkulator Prowizji 💜' })
    .setTimestamp();
}

async function sendOrUpdateKalkulator(client) {
  try {
    const channel = await client.channels.fetch(KALKULATOR_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.error('❌ Nie znaleziono kanału kalkulatora:', KALKULATOR_CHANNEL_ID);
      return;
    }

    const embed = buildKalkulatorEmbed();
    const components = buildKalkulatorComponents();
    const existingMsgId = await getConfig(KALKULATOR_MSG_KEY);

    if (existingMsgId) {
      try {
        const existing = await channel.messages.fetch(existingMsgId);
        await existing.edit({ embeds: [embed], components });
        console.log('✅ Wiadomość kalkulatora zaktualizowana!');
        return;
      } catch {
        // wiadomość usunięta – wyślij nową
      }
    }

    const msg = await channel.send({ embeds: [embed], components });
    await setConfig(KALKULATOR_MSG_KEY, msg.id);
    console.log('✅ Wiadomość kalkulatora wysłana!');
  } catch (err) {
    console.error('❌ Błąd kalkulatora:', err.message);
  }
}

// ─── BOT ───────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  console.log(`✅ Bot zalogowany jako ${client.user.tag}`);
  await initDB();
  await sendOrUpdateKalkulator(client);
});

// ─── ANTI-INVITE ───────────────────────────────────────────────────────────────
const DISCORD_LINK_REGEX = /(discord\.gg\/|discord\.com\/invite\/|dsc\.gg\/)/i;

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  if (message.guild.ownerId === message.author.id) return;

  if (DISCORD_LINK_REGEX.test(message.content)) {
    try {
      await message.delete();

      await message.author.send(
        '🚫 **Nie wysyłaj linków do żadnego discorda!**\nZa karę dostajesz przerwę na **7 dni**. Przemyśl sobie co zrobiłeś.'
      ).catch(() => {});

      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      await message.member.timeout(sevenDays, 'Wysłanie linku do Discorda');

      const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('🔨 Przerwa za link do Discorda')
          .setThumbnail(message.author.displayAvatarURL())
          .addFields(
            { name: '👤 Użytkownik', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
            { name: '🆔 ID', value: `\`${message.author.id}\``, inline: true },
            { name: '📝 Kanał', value: `<#${message.channel.id}>`, inline: true },
            { name: '💬 Treść wiadomości', value: `\`\`\`${message.content.slice(0, 200)}\`\`\`` },
            { name: '⏱️ Czas trwania', value: '7 dni', inline: true },
            { name: '🕐 Data', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
          )
          .setFooter({ text: 'SS Shop | System anty-link' });

        await logChannel.send({ embeds: [embed] });
      }

    } catch (err) {
      console.error('❌ Błąd anti-invite:', err.message);
    }
  }
});

// ─── INTERAKCJE ───────────────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {

  // ─── BUTTON — ile dolarów dostanę ─────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_dostane') {
    const selectRow = buildSelectMenuRow('select_ile_dostane');
    await interaction.reply({
      content: '💜 **Krok 1 z 2** — Wybierz metodę płatności:',
      components: [selectRow],
      ephemeral: true
    });
    return;
  }

  // Krok 2a: Wybrano metodę → pokaż modal z polem na kwotę w zł
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ile_dostane') {
    const metodaKey = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_ile_dostane_${metodaKey}`)
      .setTitle('💰 Ile dolarów serwerowych dostanę?');

    const kwotaInput = new TextInputBuilder()
      .setCustomId('kwota_zl')
      .setLabel(`Podaj kwotę w zł (np. 10zł, 100zł)`)
      .setPlaceholder('Wpisz kwotę z "zł" na końcu, np. 10zł')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(kwotaInput));
    await interaction.showModal(modal);
    return;
  }

  // Krok 3a: Obsługa modala — ile dostanę
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ile_dostane_')) {
    const metodaKey = interaction.customId.replace('modal_ile_dostane_', '');
    const metoda = PROWIZJE[metodaKey];
    const rawInput = interaction.fields.getTextInputValue('kwota_zl');
    const kwotaZl = parseZloty(rawInput);

    if (!kwotaZl) {
      await interaction.reply({
        content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`zł\` na końcu, np. \`10zł\`, \`50zł\`, \`100zł\`.\nSpróbuj ponownie!`,
        ephemeral: true
      });
      return;
    }

    // Obliczenia:
    // 1. Kwota po prowizji (to co faktycznie idzie na zakup)
    const po_prowizji_zl = kwotaZl * (1 - metoda.prowizja / 100);
    const prowizja_zl = kwotaZl - po_prowizji_zl;
    // 2. Ile to dolarów (1 zł = 8000$)
    const dolary = po_prowizji_zl * PRZELICZNIK;

    const emojiDisplay = metoda.emoji.startsWith('<') ? metoda.emoji : metoda.emoji;

    await interaction.reply({
      content:
        `💜 **Wynik kalkulatora SS Shop:**\n\n` +
        `${emojiDisplay} Metoda: **${metoda.nazwa}**\n` +
        `💵 Wysyłasz: **${kwotaZl.toFixed(2)} zł**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **-${prowizja_zl.toFixed(2)} zł**\n` +
        `💜 Dolary serwerowe, które otrzymasz: **${formatDolary(dolary)} $**`,
      ephemeral: true
    });
    return;
  }

  // ─── BUTTON — ile zapłacić za tyle dolarów serwerowych ───────────────────
  if (interaction.isButton() && interaction.customId === 'kalkulator_ile_zaplacic') {
    const selectRow = buildSelectMenuRow('select_ile_zaplacic');
    await interaction.reply({
      content: '💜 **Krok 1 z 2** — Wybierz metodę płatności:',
      components: [selectRow],
      ephemeral: true
    });
    return;
  }

  // Krok 2b: Wybrano metodę → pokaż modal z polem na kwotę w dolarach
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_ile_zaplacic') {
    const metodaKey = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`modal_ile_zaplacic_${metodaKey}`)
      .setTitle('💸 Ile zapłacić za tyle dolarów?');

    const kwotaInput = new TextInputBuilder()
      .setCustomId('kwota_dolary')
      .setLabel('Podaj kwotę $ (np. 80k, 800k, 1m)')
      .setPlaceholder('Wpisz kwotę z "k" lub "m", np. 80k')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(kwotaInput));
    await interaction.showModal(modal);
    return;
  }

  // Krok 3b: Obsługa modala — ile zapłacić
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ile_zaplacic_')) {
    const metodaKey = interaction.customId.replace('modal_ile_zaplacic_', '');
    const metoda = PROWIZJE[metodaKey];
    const rawInput = interaction.fields.getTextInputValue('kwota_dolary');
    const dolary = parseDolary(rawInput);

    if (!dolary) {
      await interaction.reply({
        content: `❌ **Nieprawidłowy format!**\nMusisz podać kwotę z \`k\` (tysiące) lub \`m\` (miliony) na końcu, np. \`80k\`, \`800k\`, \`1m\`.\nSpróbuj ponownie!`,
        ephemeral: true
      });
      return;
    }

    // Obliczenia:
    // 1. Ile zł potrzeba na te dolary (1 zł = 8000$)
    const bazowa_cena_zl = dolary / PRZELICZNIK;
    // 2. Doliczamy prowizję, aby po jej odjęciu została bazowa cena
    // Cena_z_prowizja * (1 - prowizja%) = bazowa_cena
    // Cena_z_prowizja = bazowa_cena / (1 - prowizja%)
    const do_zaplaty_zl = bazowa_cena_zl / (1 - metoda.prowizja / 100);
    const prowizja_zl = do_zaplaty_zl - bazowa_cena_zl;

    const emojiDisplay = metoda.emoji.startsWith('<') ? metoda.emoji : metoda.emoji;

    await interaction.reply({
      content:
        `💜 **Wynik kalkulatora SS Shop:**\n\n` +
        `${emojiDisplay} Metoda: **${metoda.nazwa}**\n` +
        `💜 Chcesz otrzymać: **${formatDolary(dolary)} $**\n` +
        `💸 Prowizja (\`${metoda.prowizja}%\`): **+${prowizja_zl.toFixed(2)} zł**\n` +
        `💵 Musisz zapłacić łącznie: **${do_zaplaty_zl.toFixed(2)} zł**`,
      ephemeral: true
    });
    return;
  }

  // ─── BUTTON — weryfikacja ──────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'verify') {
    const scopes = encodeURIComponent('identify guilds.join');
    const state = interaction.user.id;

    const oauthUrl =
      `https://discord.com/oauth2/authorize` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${scopes}` +
      `&state=${state}`;

    await interaction.reply({
      content: `Kliknij link poniżej, aby się zweryfikować:\n🔗 ${oauthUrl}`,
      ephemeral: true
    });
    return;
  }

  // ─── COMMAND — setup-verify ────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Brak uprawnień.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor("#6a00ff")
      .setAuthor({
        name: "💜 SS | Shop 💜 × Weryfikacja",
        iconURL: "https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png"
      })
      .setThumbnail('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png')
      .setDescription(
        ">>> Aby uzyskać dostęp do serwera, musisz przejść weryfikację.\n" +
        "Kliknij przycisk poniżej i się zweryfikuj!.\n\n"
      )
      .setImage('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify')
        .setLabel('✅ Zweryfikuj się')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Wiadomość weryfikacyjna wysłana!', ephemeral: true });
  }

  // ─── COMMAND — transfer ────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'transfer') {
    if (interaction.user.id !== '1215343846003576872') {
      return interaction.reply({ content: '❌ Nie masz uprawnień do tej komendy.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const targetGuildId = interaction.options.getString('guild_id');
    const tryb = interaction.options.getString('tryb');
    const ilosc = interaction.options.getInteger('ilosc');
    const targetUserId = interaction.options.getString('user_id');

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
      if (result.rows.length === 0) return interaction.editReply({ content: '❌ Nie znaleziono tego użytkownika w bazie!' });
      users = result.rows;
    }

    let success = 0;
    let failed = 0;
    let alreadyOnServer = 0;
    let deauthorized = 0;

    for (const row of users) {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const accessToken = await refreshAccessToken(row.user_id);
          if (!accessToken) { failed++; break; }

          const response = await axios.put(
            `https://discord.com/api/guilds/${targetGuildId}/members/${row.user_id}`,
            { access_token: accessToken },
            {
              headers: {
                Authorization: `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );

          if (response.status === 204) {
            alreadyOnServer++;
          } else {
            success++;

            try {
              const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
              if (targetGuild) {
                const member = await targetGuild.members.fetch(row.user_id).catch(() => null);
                if (member) await member.roles.add('1495432509263974431');
              }
            } catch (roleErr) {
              console.error(`❌ Błąd nadawania rangi dla ${row.user_id}:`, roleErr.message);
            }

            try {
              const joinChannel = await client.channels.fetch('1495432511893803063').catch(() => null);
              if (joinChannel) {
                await joinChannel.send(`💜 Użytkownik <@${row.user_id}> wszedł na serwer za pomocą bota SS Shop 💜`);
              }
            } catch (msgErr) {
              console.error(`❌ Błąd wysyłania wiadomości powitalnej:`, msgErr.message);
            }
          }
          break;

        } catch (err) {
          const data = err?.response?.data;

          if (err?.response?.status === 429 && data?.retry_after) {
            const waitMs = Math.ceil(data.retry_after) + 200;
            console.log(`⏳ Rate limit dla ${row.user_id}, czekam ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
            attempts++;
            continue;
          }

          if (data?.code === 50025) {
            deauthorized++;
            break;
          }

          console.error(`❌ Błąd dodawania ${row.user_id}:`, data || err.message);
          failed++;
          break;
        }
      }

      if (attempts >= maxAttempts) {
        console.error(`❌ Przekroczono limit prób dla ${row.user_id}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 1100));
    }

    await interaction.editReply({
      content: `✅ Transfer zakończony!\n✅ Dodano: **${success}** użytkowników\n👥 Już na serwerze: **${alreadyOnServer}**\n❌ Błędów: **${failed}**\n🚫 Odautoryzowali: **${deauthorized}**`
    });
  }
});

client.login(BOT_TOKEN);

// ─── REJESTRACJA KOMEND ────────────────────────────────────────────────────────
if (process.argv.includes('--setup')) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('Wysyła wiadomość weryfikacyjną z przyciskiem')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('transfer')
      .setDescription('Przenosi użytkowników na podany serwer')
      .addStringOption(opt =>
        opt.setName('guild_id')
          .setDescription('ID serwera docelowego')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('tryb')
          .setDescription('all = wszyscy, random = losowi, id = konkretna osoba')
          .setRequired(true)
          .addChoices(
            { name: 'Wszyscy', value: 'all' },
            { name: 'Losowi', value: 'random' },
            { name: 'Konkretna osoba (po ID)', value: 'id' }
          )
      )
      .addIntegerOption(opt =>
        opt.setName('ilosc')
          .setDescription('Ile losowych osób (tylko przy trybie random)')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('user_id')
          .setDescription('ID użytkownika (tylko przy trybie id)')
          .setRequired(false)
      )
      .toJSON()
  ];

  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    .then(() => {
      console.log('✅ Komendy zarejestrowane!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Błąd rejestracji komend:', err);
      process.exit(1);
    });
}

// ─── SERWER HTTP ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bot działa!'));

app.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send('❌ Brak kodu autoryzacji lub ID użytkownika.');
  }

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;
    const expiresAt = Date.now() + tokenRes.data.expires_in * 1000;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const discordUserId = userRes.data.id;
    const username = userRes.data.username;
    const globalName = userRes.data.global_name || username;
    const avatar = userRes.data.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUserId}/${userRes.data.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    await saveUser({
      user_id: discordUserId,
      username,
      global_name: globalName,
      avatar,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt
    });

    await axios.put(
      `https://discord.com/api/guilds/${GUILD_ID}/members/${discordUserId}`,
      { access_token: accessToken },
      {
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (member) await member.roles.add(ROLE_ID);

    const joinChannel = client.channels.cache.get('1495432511893803063');
    if (joinChannel) {
      await joinChannel.send(`💜 Użytkownik <@${discordUserId}> wszedł na serwer za pomocą bota SS Shop 💜`);
    }

    const now = new Date();
    const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x6a00ff)
        .setTitle('✅ Nowa weryfikacja')
        .setThumbnail(avatar)
        .addFields(
          { name: '👤 Użytkownik', value: `${globalName} (\`${username}\`)`, inline: true },
          { name: '🆔 ID', value: `\`${discordUserId}\``, inline: true },
          { name: '🕐 Czas', value: `<t:${Math.floor(now.getTime() / 1000)}:F>`, inline: false }
        )
        .setFooter({ text: 'SS Shop | System weryfikacji' })
        .setTimestamp(now);

      await logChannel.send({ embeds: [logEmbed] });
    }

    return res.send(`
      <html>
        <head><title>Weryfikacja</title></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#23272a;color:#fff">
          <h1>✅ Zweryfikowano!</h1>
          <p>Możesz wrócić na Discord. Ranga została nadana.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('❌ Błąd weryfikacji:', err?.response?.data || err.message);
    return res.status(500).send(`
      <html>
        <head><title>Błąd</title></head>
        <body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#23272a;color:#fff">
          <h1>❌ Wystąpił błąd</h1>
          <p>Spróbuj ponownie lub skontaktuj się z administracją.</p>
        </body>
      </html>
    `);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serwer HTTP działa na porcie ${PORT}`);
});
