// ============================================================
//  ArenaForge Bot Discord
//  Installe les dépendances : npm install discord.js @discordjs/rest
//  Lance le bot : node index.js
// ============================================================

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────
const TOKEN = process.env.TOKEN;   // 👈 remplace ici
const GAME_URL  = 'https://couscoussecom-arch.github.io/free/'; // 👈 lien vers ton jeu hébergé
const DB_FILE   = path.join(__dirname, 'data', 'players.json');
const PREFIX    = '!';

// ─── RANGS ─────────────────────────────────────────────────
const RANKS = [
  { name: '🪨 Novice',    min: 0,    color: 0x888888 },
  { name: '🥉 Bronze',    min: 100,  color: 0xcd7f32 },
  { name: '🥈 Argent',    min: 300,  color: 0xC0C0C0 },
  { name: '🥇 Or',        min: 600,  color: 0xFFD700 },
  { name: '💎 Diamant',   min: 1000, color: 0x00BFFF },
  { name: '👑 Champion',  min: 2000, color: 0xFF4500 },
];

function getRank(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) { if (xp >= r.min) rank = r; }
  return rank;
}

// ─── BASE DE DONNÉES LOCALE (JSON) ─────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function getPlayer(db, userId, username) {
  if (!db[userId]) {
    db[userId] = { username, xp: 0, wins: 0, losses: 0, duelsPlayed: 0, dailyClaimed: null };
  }
  db[userId].username = username; // màj pseudo
  return db[userId];
}

// ─── CLIENT DISCORD ────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Duels en attente : Map<challengerId, { challenger, challenged, channelId, messageId }>
const pendingDuels = new Map();
// Duels actifs (pour éviter doubles duels)
const activeDuels  = new Set();

// ─── READY ─────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ ArenaForge Bot connecté en tant que ${client.user.tag}`);
  client.user.setActivity('ArenaForge ⚔️ | !aide', { type: 'PLAYING' });
});

// ─── MESSAGES ──────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args    = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const db      = loadDB();

  // ── !aide ──────────────────────────────────────────────
  if (command === 'aide' || command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('⚔️ ArenaForge — Commandes')
      .setColor(0x4466ff)
      .setDescription('Bienvenue dans le serveur ArenaForge !')
      .addFields(
        { name: '`!jouer`',            value: 'Ouvre le lien du jeu ArenaForge',         inline: true },
        { name: '`!duel @joueur`',     value: 'Défie un autre joueur en duel',            inline: true },
        { name: '`!profil [@joueur]`', value: 'Affiche ton profil ou celui d\'un joueur', inline: true },
        { name: '`!classement`',       value: 'Top 10 des joueurs du serveur',            inline: true },
        { name: '`!daily`',            value: 'Récompense quotidienne (50 XP)',           inline: true },
        { name: '`!rang`',             value: 'Affiche les rangs disponibles',            inline: true },
      )
      .setFooter({ text: 'ArenaForge — Forge ta légende !' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !jouer ─────────────────────────────────────────────
  if (command === 'jouer' || command === 'play') {
    const embed = new EmbedBuilder()
      .setTitle('🎮 Jouer à ArenaForge')
      .setColor(0xff6622)
      .setDescription(`Clique ci-dessous pour rejoindre l'arène !\n\n🔥 Sorts · 🧱 Murs destructibles · ⚔️ PvP en temps réel`)
      .setURL(GAME_URL);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🕹️ Jouer maintenant').setStyle(ButtonStyle.Link).setURL(GAME_URL)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }

  // ── !profil ────────────────────────────────────────────
  if (command === 'profil' || command === 'profile') {
    const target = message.mentions.users.first() || message.author;
    const p      = getPlayer(db, target.id, target.username);
    const rank   = getRank(p.xp);
    const next   = RANKS.find(r => r.min > p.xp);
    const nextTxt = next ? `${next.min - p.xp} XP pour atteindre ${next.name}` : 'Rang maximum atteint !';
    const ratio   = p.duelsPlayed > 0 ? ((p.wins / p.duelsPlayed) * 100).toFixed(0) + '%' : 'N/A';

    const embed = new EmbedBuilder()
      .setTitle(`${rank.name} — ${target.username}`)
      .setColor(rank.color)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: '✨ XP',        value: `**${p.xp}**`,        inline: true },
        { name: '🏆 Victoires', value: `**${p.wins}**`,      inline: true },
        { name: '💀 Défaites',  value: `**${p.losses}**`,    inline: true },
        { name: '⚔️ Duels',    value: `**${p.duelsPlayed}**`,inline: true },
        { name: '📊 Win rate',  value: `**${ratio}**`,        inline: true },
        { name: '🎯 Prochain',  value: nextTxt,               inline: false },
      )
      .setFooter({ text: 'ArenaForge — Forge ta légende !' })
      .setTimestamp();

    saveDB(db);
    return message.reply({ embeds: [embed] });
  }

  // ── !classement ────────────────────────────────────────
  if (command === 'classement' || command === 'leaderboard' || command === 'top') {
    const sorted = Object.entries(db)
      .sort(([,a],[,b]) => b.xp - a.xp)
      .slice(0, 10);

    const medals = ['🥇','🥈','🥉'];
    const lines  = sorted.map(([,p], i) => {
      const rank = getRank(p.xp);
      const med  = medals[i] || `**${i+1}.**`;
      return `${med} ${rank.name.split(' ')[0]} **${p.username}** — ${p.xp} XP (${p.wins}V/${p.losses}D)`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏆 Classement ArenaForge')
      .setColor(0xFFD700)
      .setDescription(lines.length ? lines.join('\n') : 'Aucun joueur pour l\'instant !')
      .setFooter({ text: `Utilise !duel @joueur pour grimper !` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !rang ──────────────────────────────────────────────
  if (command === 'rang' || command === 'ranks') {
    const lines = RANKS.map(r => `• **${r.name}** — à partir de ${r.min} XP`);
    const embed = new EmbedBuilder()
      .setTitle('🎖️ Rangs ArenaForge')
      .setColor(0x44aaff)
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Duel pour gagner de l\'XP !' });
    return message.reply({ embeds: [embed] });
  }

  // ── !daily ─────────────────────────────────────────────
  if (command === 'daily') {
    const p    = getPlayer(db, message.author.id, message.author.username);
    const now  = new Date();
    const last = p.dailyClaimed ? new Date(p.dailyClaimed) : null;
    const sameDay = last && last.toDateString() === now.toDateString();

    if (sameDay) {
      const next = new Date(last); next.setDate(next.getDate()+1);
      const diff = Math.ceil((next - now) / 1000 / 3600);
      return message.reply(`⏳ Tu as déjà réclamé ta récompense aujourd'hui ! Reviens dans **${diff}h**.`);
    }

    const reward   = 50;
    p.xp          += reward;
    p.dailyClaimed = now.toISOString();
    const rank     = getRank(p.xp);
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🎁 Récompense quotidienne !')
      .setColor(0x44ff88)
      .setDescription(`Tu as gagné **+${reward} XP** !\nTotal : **${p.xp} XP** — Rang : ${rank.name}`)
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !duel @joueur ──────────────────────────────────────
  if (command === 'duel') {
    const challenged = message.mentions.users.first();
    if (!challenged) return message.reply('❌ Mentionne un joueur ! Ex : `!duel @JoueurCible`');
    if (challenged.id === message.author.id) return message.reply('❌ Tu ne peux pas te défier toi-même !');
    if (challenged.bot) return message.reply('❌ Les bots ne jouent pas (encore) !');

    if (activeDuels.has(message.author.id) || activeDuels.has(challenged.id)) {
      return message.reply('❌ Un joueur est déjà en duel ! Attendez que le duel actuel se termine.');
    }

    const challenger = message.author;
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Défi de duel !')
      .setColor(0xff6622)
      .setDescription(
        `**${challenger.username}** défie **${challenged.username}** en duel !\n\n` +
        `${challenged}, acceptes-tu le défi ?\n` +
        `⏰ Tu as **60 secondes** pour répondre.`
      )
      .addFields(
        { name: '🎮 Lien du jeu', value: `[Cliquez ici pour jouer](${GAME_URL})` }
      )
      .setFooter({ text: 'ArenaForge — Forge ta légende !' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_${challenger.id}_${challenged.id}`).setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`refuse_${challenger.id}_${challenged.id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
    );

    const msg = await message.channel.send({ content: `${challenged}`, embeds: [embed], components: [row] });
    pendingDuels.set(challenger.id, { challenger, challenged, channelId: message.channel.id, messageId: msg.id });

    // Timeout 60s
    setTimeout(async () => {
      if (pendingDuels.has(challenger.id)) {
        pendingDuels.delete(challenger.id);
        try {
          await msg.edit({ components: [] });
          await message.channel.send(`⏰ Le défi de **${challenger.username}** a expiré.`);
        } catch (_) {}
      }
    }, 60000);

    return;
  }

  // ── !victoire / !defaite ───────────────────────────────
  // Ces commandes permettent d'enregistrer le résultat d'un duel manuellement
  // (idéalement via un webhook depuis le jeu)
  if (command === 'victoire' || command === 'win') {
    const opponent = message.mentions.users.first();
    if (!opponent) return message.reply('❌ Mentionne ton adversaire : `!victoire @adversaire`');
    if (opponent.id === message.author.id) return message.reply('❌ Triche détectée !');

    const pw = getPlayer(db, message.author.id, message.author.username);
    const pl = getPlayer(db, opponent.id, opponent.username);
    const xpGain = 30 + Math.max(0, pl.xp - pw.xp) / 20;
    const gainRounded = Math.round(xpGain);

    pw.wins++;pw.duelsPlayed++;pw.xp+=gainRounded;
    pl.losses++;pl.duelsPlayed++;
    saveDB(db);

    const rank = getRank(pw.xp);
    const embed = new EmbedBuilder()
      .setTitle('🏆 Victoire enregistrée !')
      .setColor(0x44ff88)
      .setDescription(
        `**${message.author.username}** bat **${opponent.username}** !\n` +
        `+**${gainRounded} XP** → Total : **${pw.xp} XP** — ${rank.name}`
      )
      .setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // ── !admin-reset @joueur ───────────────────────────────
  if (command === 'admin-reset') {
    if (!message.member.permissions.has('Administrator')) return message.reply('❌ Admin uniquement !');
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Mentionne un joueur.');
    delete db[target.id];
    saveDB(db);
    return message.reply(`✅ Profil de **${target.username}** réinitialisé.`);
  }
});

// ─── BOUTONS (accepter/refuser duel) ───────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const [action, challengerId, challengedId] = interaction.customId.split('_');

  if (!['accept','refuse'].includes(action)) return;

  const duel = pendingDuels.get(challengerId);
  if (!duel) return interaction.reply({ content: '⏰ Ce défi a expiré.', ephemeral: true });

  if (interaction.user.id !== challengedId) {
    return interaction.reply({ content: '❌ Ce défi ne te concerne pas.', ephemeral: true });
  }

  pendingDuels.delete(challengerId);

  if (action === 'refuse') {
    await interaction.update({ components: [] });
    return interaction.followUp(`❌ **${duel.challenged.username}** a refusé le défi de **${duel.challenger.username}**.`);
  }

  // ACCEPTÉ
  activeDuels.add(challengerId);
  activeDuels.add(challengedId);

  const db   = loadDB();
  const pc   = getPlayer(db, challengerId,  duel.challenger.username);
  const pd   = getPlayer(db, challengedId, duel.challenged.username);
  saveDB(db);

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Duel commencé !')
    .setColor(0xff4444)
    .setDescription(
      `**${duel.challenger.username}** (${getRank(pc.xp).name}) VS **${duel.challenged.username}** (${getRank(pd.xp).name})\n\n` +
      `🎮 **Rendez-vous sur le jeu et jouez !**\n` +
      `Une fois terminé, le gagnant tape \`!victoire @perdant\` pour enregistrer son score.\n\n` +
      `[👉 Lancer ArenaForge](${GAME_URL})`
    )
    .setFooter({ text: 'Bonne chance à tous les deux !' })
    .setTimestamp();

  await interaction.update({ components: [] });
  await interaction.followUp({ embeds: [embed] });

  // Auto-clean activeDuels après 15 min
  setTimeout(() => {
    activeDuels.delete(challengerId);
    activeDuels.delete(challengedId);
  }, 15 * 60 * 1000);
});

// ─── LANCEMENT ─────────────────────────────────────────────
client.login(TOKEN);
