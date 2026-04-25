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
      .setTitle("**🔐 SS | Shop × Weryfikacja**")
      .setDescription(">>> Kliknij przycisk poniżej i zweryfikuj się, aby uzyskać dostęp.")
      .setColor("#5865F2")
      .setImage('https://cdn.discordapp.com/attachments/1472524342125658168/1497735741252440226/image.png?ex=69ee9a9b&is=69ed491b&hm=0a4c961aeca25e57f2b4f1c18d7b7e67eafb29da147bf68eb4ec22a946a1144d&');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify')
        .setLabel('✅ Zweryfikuj się')
        .setStyle(ButtonStyle.Primary)
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
