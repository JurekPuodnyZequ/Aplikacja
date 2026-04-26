require('dotenv').config();
const express = require('express');
const axios = require('axios');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
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

// ─── BOT ───────────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', () => {
  console.log(`✅ Bot zalogowany jako ${client.user.tag}`);
});

// Przycisk weryfikacji — odsyła użytkownika do OAuth2
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

  // Slash command /setup-verify
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
});

client.login(BOT_TOKEN);

// ─── REJESTRACJA KOMENDY (node index.js --setup) ───────────────────────────────
if (process.argv.includes('--setup')) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const commands = [
    new SlashCommandBuilder()
      .setName('setup-verify')
      .setDescription('Wysyła wiadomość weryfikacyjną z przyciskiem')
      .toJSON()
  ];

  rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
    .then(() => {
      console.log('✅ Komenda /setup-verify zarejestrowana!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Błąd rejestracji komendy:', err);
      process.exit(1);
    });
}

// ─── SERWER HTTP ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Bot działa!');
});

app.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send('❌ Brak kodu autoryzacji lub ID użytkownika.');
  }

  try {
    // 1. Wymiana code na access_token
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

    // 2. Pobierz dane użytkownika
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const discordUserId = userRes.data.id;
    const username = userRes.data.username;
    const globalName = userRes.data.global_name || username;
    const avatar = userRes.data.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUserId}/${userRes.data.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;

    // 3. Dodaj użytkownika na serwer (guilds.join)
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

    // 4. Nadaj rangę
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordUserId).catch(() => null);

    if (member) {
      await member.roles.add(ROLE_ID);

      // 5. Wyślij powiadomienie na webhook
      const now = new Date();
      const timestamp = now.toISOString();

      await axios.post(WEBHOOK_URL, {
        embeds: [
          {
            title: '✅ Nowa weryfikacja',
            color: 0x6a00ff,
            thumbnail: { url: avatar },
            fields: [
              {
                name: '👤 Użytkownik',
                value: `${globalName} (\`${username}\`)`,
                inline: true
              },
              {
                name: '🆔 ID',
                value: `\`${discordUserId}\``,
                inline: true
              },
              {
                name: '🕐 Czas',
                value: `<t:${Math.floor(now.getTime() / 1000)}:F>`,
                inline: false
              }
            ],
            footer: { text: 'SS Shop | System weryfikacji' },
            timestamp
          }
        ]
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
    } else {
      return res.send(`
        <html>
          <head><title>Weryfikacja</title></head>
          <body style="font-family:sans-serif;text-align:center;margin-top:100px;background:#23272a;color:#fff">
            <h1>⚠️ Nie znaleziono cię na serwerze</h1>
            <p>Upewnij się, że jesteś na serwerze i spróbuj ponownie.</p>
          </body>
        </html>
      `);
    }
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
