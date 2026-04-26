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

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1497965591225569460/aA-EGI6HGwk2ExM6cl8RqnkX4LzfEGt4NiBaiT0nMcrVIvAr0hXZnQXWWEK7KdZlas1Q';
const LOG_CHANNEL_ID = '1495432512506429465';

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
});

// ─── ANTI-INVITE ───────────────────────────────────────────────────────────────
const DISCORD_LINK_REGEX = /(discord\.gg\/|discord\.com\/invite\/|dsc\.gg\/)/i;

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Pomiń adminów i właściciela serwera
  if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
  if (message.guild.ownerId === message.author.id) return;

  if (DISCORD_LINK_REGEX.test(message.content)) {
    try {
      // Usuń wiadomość
      await message.delete();

      // Wyślij PV
      await message.author.send(
        '🚫 **Nie wysyłaj linków do żadnego discorda!**\nZa karę dostajesz przerwę na **7 dni**. Przemyśl sobie co zrobiłeś.'
      ).catch(() => {});

      // Daj timeout na 7 dni
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      await message.member.timeout(sevenDays, 'Wysłanie linku do Discorda');

      // Wyślij log na kanał
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

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-verify') {
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

    for (const row of users) {
      try {
        const accessToken = await refreshAccessToken(row.user_id);
        if (!accessToken) { failed++; continue; }

        await axios.put(
          `https://discord.com/api/guilds/${targetGuildId}/members/${row.user_id}`,
          { access_token: accessToken },
          {
            headers: {
              Authorization: `Bot ${BOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );
        success++;
      } catch (err) {
        console.error(`❌ Błąd dodawania ${row.user_id}:`, err?.response?.data || err.message);
        failed++;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    await interaction.editReply({
      content: `✅ Transfer zakończony!\n✅ Dodano: **${success}** użytkowników\n❌ Błędów: **${failed}**`
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

    const now = new Date();
    await axios.post(WEBHOOK_URL, {
      embeds: [{
        title: '✅ Nowa weryfikacja',
        color: 0x6a00ff,
        thumbnail: { url: avatar },
        fields: [
          { name: '👤 Użytkownik', value: `${globalName} (\`${username}\`)`, inline: true },
          { name: '🆔 ID', value: `\`${discordUserId}\``, inline: true },
          { name: '🕐 Czas', value: `<t:${Math.floor(now.getTime() / 1000)}:F>`, inline: false }
        ],
        footer: { text: 'SS Shop | System weryfikacji' },
        timestamp: now.toISOString()
      }]
    });

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
