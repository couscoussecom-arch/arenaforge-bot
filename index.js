// ============================================================
//  ArenaForge Bot Discord — Système de Tickets de Duel
//  npm install discord.js
//  node index.js
// ============================================================

const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────
const TOKEN    = process.env.TOKEN;
const GAME_URL = 'https://couscoussecom-arch.github.io/free/';
const DB_FILE  = path.join(__dirname, 'data', 'players.json');
const PREFIX   = '!';

// Nom de la catégorie où les tickets seront créés
const TICKET_CATEGORY_NAME = '⚔️ DUELS EN COURS';
// Nom du salon où le bouton de duel sera affiché
const DUEL_CHANNEL_NAME    = 'duels';

// ─── RANGS ─────────────────────────────────────────────────
const RANKS = [
  { name: '🪨 Novice',   min: 0,    color: 0x888888 },
  { name: '🥉 Bronze',   min: 100,  color: 0xcd7f32 },
  { name: '🥈 Argent',   min: 300,  color: 0xC0C0C0 },
  { name: '🥇 Or',       min: 600,  color: 0xFFD700 },
  { name: '💎 Diamant',  min: 1000, color: 0x00BFFF },
  { name: '👑 Champion', min: 2000, color: 0xFF4500 },
];
function getRank(xp){ let r=RANKS[0]; for(const x of RANKS)if(xp>=x.min)r=x; return r; }

// ─── DB ────────────────────────────────────────────────────
function loadDB(){ if(!fs.existsSync(DB_FILE))fs.writeFileSync(DB_FILE,'{}'); return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
function saveDB(db){ fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2)); }
function getPlayer(db,id,name){ if(!db[id])db[id]={username:name,xp:0,wins:0,losses:0,duelsPlayed:0,dailyClaimed:null}; db[id].username=name; return db[id]; }

// ─── CLIENT ────────────────────────────────────────────────
const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// tickets actifs : Map<channelId, {challenger, challenged, guildId}>
const activeTickets = new Map();
// joueurs en attente de duel (ont cliqué sur le bouton)
const waitingPlayers = new Map(); // userId -> {user, channelId, messageId, timer}

// ─── READY ─────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ ArenaForge Bot connecté en tant que ${client.user.tag}`);
  client.user.setActivity('ArenaForge ⚔️ | !aide', { type: 'PLAYING' });
});

// ─── SETUP AUTO DU SALON DUELS ─────────────────────────────
// Lance !setup dans n'importe quel salon pour créer le panneau de duel
async function setupDuelPanel(guild, channel) {
  // Créer la catégorie tickets si elle n'existe pas
  let cat = guild.channels.cache.find(c=>c.name===TICKET_CATEGORY_NAME&&c.type===ChannelType.GuildCategory);
  if(!cat){
    cat = await guild.channels.create({
      name: TICKET_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]}]
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Arène des Duels — ArenaForge')
    .setColor(0xff6622)
    .setDescription(
      `Clique sur le bouton ci-dessous pour **demander un duel** !\n\n` +
      `**Comment ça marche ?**\n` +
      `1️⃣ Clique sur **🎮 Demander un duel**\n` +
      `2️⃣ Un ticket privé s'ouvre pour toi\n` +
      `3️⃣ Mentionne ton adversaire avec \`!défier @joueur\`\n` +
      `4️⃣ Il accepte et vous recevez le lien du jeu\n` +
      `5️⃣ Combattez et enregistrez le résultat !\n\n` +
      `🏆 Chaque victoire rapporte de l'XP et fait monter ton rang !`
    )
    .setFooter({ text: 'ArenaForge — Forge ta légende !' })
    .setImage('https://i.imgur.com/placeholder.png')
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_duel_ticket')
      .setLabel('🎮 Demander un duel')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('show_leaderboard')
      .setLabel('🏆 Classement')
      .setStyle(ButtonStyle.Secondary),
  );

  await channel.send({ embeds:[embed], components:[row] });
  return cat;
}

// ─── MESSAGES ──────────────────────────────────────────────
client.on('messageCreate', async msg => {
  if(msg.author.bot||!msg.content.startsWith(PREFIX))return;
  const args=msg.content.slice(1).trim().split(/\s+/);
  const cmd=args.shift().toLowerCase();
  const db=loadDB();

  // ── !aide ──────────────────────────────────────────────
  if(cmd==='aide'||cmd==='help'){
    const embed=new EmbedBuilder()
      .setTitle('⚔️ ArenaForge — Commandes')
      .setColor(0x4466ff)
      .addFields(
        {name:'`!setup`',value:'(Admin) Crée le panneau de duel dans ce salon',inline:true},
        {name:'`!défier @joueur`',value:'Défie un joueur dans un ticket',inline:true},
        {name:'`!victoire`',value:'Enregistre ta victoire et ferme le ticket',inline:true},
        {name:'`!fermer`',value:'Ferme le ticket de duel',inline:true},
        {name:'`!profil [@joueur]`',value:'Affiche un profil',inline:true},
        {name:'`!classement`',value:'Top 10 du serveur',inline:true},
        {name:'`!daily`',value:'+50 XP par jour',inline:true},
        {name:'`!rang`',value:'Liste des rangs',inline:true},
      )
      .setFooter({text:'ArenaForge — Forge ta légende !'});
    return msg.reply({embeds:[embed]});
  }

  // ── !setup ─────────────────────────────────────────────
  if(cmd==='setup'){
    if(!msg.member.permissions.has('Administrator'))return msg.reply('❌ Admin uniquement !');
    await setupDuelPanel(msg.guild, msg.channel);
    return msg.reply('✅ Panneau de duel créé !');
  }

  // ── !défier dans un ticket ─────────────────────────────
  if(cmd==='défier'||cmd==='defier'||cmd==='challenge'){
    const ticket=activeTickets.get(msg.channel.id);
    if(!ticket)return msg.reply('❌ Cette commande s\'utilise dans un ticket de duel !');
    if(ticket.challenged)return msg.reply('❌ Un adversaire est déjà dans ce ticket !');

    const challenged=msg.mentions.users.first();
    if(!challenged)return msg.reply('❌ Mentionne un joueur ! Ex: `!défier @joueur`');
    if(challenged.id===msg.author.id)return msg.reply('❌ Tu ne peux pas te défier toi-même !');
    if(challenged.bot)return msg.reply('❌ Les bots ne jouent pas !');

    ticket.challenged=challenged;
    const pc=getPlayer(db,ticket.challenger.id,ticket.challenger.username);
    const pd=getPlayer(db,challenged.id,challenged.username);
    saveDB(db);

    // Donner accès au salon à l'adversaire
    await msg.channel.permissionOverwrites.edit(challenged,{
      ViewChannel:true, SendMessages:true, ReadMessageHistory:true
    });
    await msg.channel.setName(`duel-${ticket.challenger.username}-vs-${challenged.username}`.toLowerCase().replace(/\s/g,'-').slice(0,50));

    const embed=new EmbedBuilder()
      .setTitle('⚔️ Défi lancé !')
      .setColor(0xff6622)
      .setDescription(
        `**${ticket.challenger.username}** (${getRank(pc.xp).name}) défie **${challenged.username}** (${getRank(pd.xp).name}) !\n\n` +
        `${challenged}, acceptes-tu le défi ?`
      );

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`accept_duel_${msg.channel.id}`).setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`refuse_duel_${msg.channel.id}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
    );
    return msg.channel.send({content:`${challenged}`,embeds:[embed],components:[row]});
  }

  // ── !victoire ──────────────────────────────────────────
  if(cmd==='victoire'||cmd==='win'){
    const ticket=activeTickets.get(msg.channel.id);
    if(!ticket||!ticket.challenged){
      // victoire hors ticket (ancienne méthode)
      const opponent=msg.mentions.users.first();
      if(!opponent)return msg.reply('❌ Mentionne ton adversaire : `!victoire @adversaire`');
      const pw=getPlayer(db,msg.author.id,msg.author.username);
      const pl=getPlayer(db,opponent.id,opponent.username);
      const gain=Math.round(30+Math.max(0,pl.xp-pw.xp)/20);
      pw.wins++;pw.duelsPlayed++;pw.xp+=gain;
      pl.losses++;pl.duelsPlayed++;
      saveDB(db);
      const embed=new EmbedBuilder().setTitle('🏆 Victoire !').setColor(0x44ff88)
        .setDescription(`**${msg.author.username}** bat **${opponent.username}** !\n+**${gain} XP** → **${pw.xp} XP** — ${getRank(pw.xp).name}`);
      return msg.channel.send({embeds:[embed]});
    }

    // victoire dans un ticket
    const winner=msg.author;
    const loser=winner.id===ticket.challenger.id?ticket.challenged:ticket.challenger;
    const pw=getPlayer(db,winner.id,winner.username);
    const pl=getPlayer(db,loser.id,loser.username);
    const gain=Math.round(30+Math.max(0,pl.xp-pw.xp)/20);
    pw.wins++;pw.duelsPlayed++;pw.xp+=gain;
    pl.losses++;pl.duelsPlayed++;
    saveDB(db);

    const embed=new EmbedBuilder()
      .setTitle('🏆 Duel terminé !')
      .setColor(0x44ff88)
      .setDescription(
        `🥇 **${winner.username}** remporte le duel !\n` +
        `💀 **${loser.username}** est vaincu.\n\n` +
        `**${winner.username}** gagne **+${gain} XP** → **${pw.xp} XP** — ${getRank(pw.xp).name}\n\n` +
        `Ce ticket sera fermé dans 30 secondes.`
      );
    await msg.channel.send({embeds:[embed]});

    setTimeout(async()=>{
      activeTickets.delete(msg.channel.id);
      await msg.channel.delete().catch(()=>{});
    },30000);
    return;
  }

  // ── !fermer ────────────────────────────────────────────
  if(cmd==='fermer'||cmd==='close'){
    const ticket=activeTickets.get(msg.channel.id);
    if(!ticket)return msg.reply('❌ Ce n\'est pas un ticket de duel !');
    if(msg.author.id!==ticket.challenger.id&&!msg.member.permissions.has('Administrator'))
      return msg.reply('❌ Seul le créateur du ticket ou un admin peut fermer !');

    await msg.channel.send('🔒 Fermeture du ticket dans 5 secondes...');
    setTimeout(async()=>{
      activeTickets.delete(msg.channel.id);
      await msg.channel.delete().catch(()=>{});
    },5000);
    return;
  }

  // ── !profil ────────────────────────────────────────────
  if(cmd==='profil'||cmd==='profile'){
    const target=msg.mentions.users.first()||msg.author;
    const p=getPlayer(db,target.id,target.username);
    const rank=getRank(p.xp);
    const next=RANKS.find(r=>r.min>p.xp);
    const ratio=p.duelsPlayed>0?((p.wins/p.duelsPlayed)*100).toFixed(0)+'%':'N/A';
    const embed=new EmbedBuilder()
      .setTitle(`${rank.name} — ${target.username}`)
      .setColor(rank.color)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        {name:'✨ XP',value:`**${p.xp}**`,inline:true},
        {name:'🏆 Victoires',value:`**${p.wins}**`,inline:true},
        {name:'💀 Défaites',value:`**${p.losses}**`,inline:true},
        {name:'⚔️ Duels',value:`**${p.duelsPlayed}**`,inline:true},
        {name:'📊 Win rate',value:`**${ratio}**`,inline:true},
        {name:'🎯 Prochain',value:next?`${next.min-p.xp} XP pour ${next.name}`:'Rang max !',inline:false},
      ).setTimestamp();
    saveDB(db);
    return msg.reply({embeds:[embed]});
  }

  // ── !classement ────────────────────────────────────────
  if(cmd==='classement'||cmd==='top'){
    const sorted=Object.entries(db).sort(([,a],[,b])=>b.xp-a.xp).slice(0,10);
    const medals=['🥇','🥈','🥉'];
    const lines=sorted.map(([,p],i)=>`${medals[i]||`**${i+1}.**`} ${getRank(p.xp).name.split(' ')[0]} **${p.username}** — ${p.xp} XP (${p.wins}V/${p.losses}D)`);
    const embed=new EmbedBuilder().setTitle('🏆 Classement ArenaForge').setColor(0xFFD700)
      .setDescription(lines.length?lines.join('\n'):'Aucun joueur !').setTimestamp();
    return msg.reply({embeds:[embed]});
  }

  // ── !rang ──────────────────────────────────────────────
  if(cmd==='rang'||cmd==='ranks'){
    const embed=new EmbedBuilder().setTitle('🎖️ Rangs ArenaForge').setColor(0x44aaff)
      .setDescription(RANKS.map(r=>`• **${r.name}** — ${r.min} XP`).join('\n'));
    return msg.reply({embeds:[embed]});
  }

  // ── !entrainement ──────────────────────────────────────
  if(cmd==='entrainement'||cmd==='training'||cmd==='train'){
    const embed=new EmbedBuilder()
      .setTitle('🎯 Mode Entraînement — ArenaForge')
      .setColor(0xffcc44)
      .setDescription(
        `Affûte ta précision avant les vrais duels !\n\n`+
        `**3 difficultés disponibles :**\n`+
        `🟢 **Facile** — Cibles lentes, grand rayon\n`+
        `🟡 **Moyen** — Cibles normales, 60 secondes\n`+
        `🔴 **Difficile** — Cibles rapides, petit rayon\n\n`+
        `🔥 Enchaîne les cibles pour faire des **combos** !\n`+
        `🌟 Bats ton record personnel !`
      )
      .setFooter({text:'ArenaForge — Forge ta légende !'});
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🎯 Lancer l'entraînement')
        .setStyle(ButtonStyle.Link)
        .setURL('https://couscoussecom-arch.github.io/free/training.html')
    );
    return msg.reply({embeds:[embed],components:[row]});
  }

  // ── !daily ─────────────────────────────────────────────
  if(cmd==='daily'){
    const p=getPlayer(db,msg.author.id,msg.author.username);
    const now=new Date(),last=p.dailyClaimed?new Date(p.dailyClaimed):null;
    if(last&&last.toDateString()===now.toDateString()){
      const next=new Date(last);next.setDate(next.getDate()+1);
      return msg.reply(`⏳ Reviens dans **${Math.ceil((next-now)/3600000)}h** !`);
    }
    p.xp+=50;p.dailyClaimed=now.toISOString();saveDB(db);
    const embed=new EmbedBuilder().setTitle('🎁 Récompense quotidienne !').setColor(0x44ff88)
      .setDescription(`+**50 XP** ! Total : **${p.xp} XP** — ${getRank(p.xp).name}`);
    return msg.reply({embeds:[embed]});
  }

  // ── !admin-reset ───────────────────────────────────────
  if(cmd==='admin-reset'){
    if(!msg.member.permissions.has('Administrator'))return msg.reply('❌ Admin uniquement !');
    const target=msg.mentions.users.first();
    if(!target)return msg.reply('❌ Mentionne un joueur.');
    delete db[target.id];saveDB(db);
    return msg.reply(`✅ Profil de **${target.username}** réinitialisé.`);
  }
});

// ─── BOUTONS ───────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if(!interaction.isButton())return;
  const {customId, user, guild, member} = interaction;

  // ── Ouvrir un ticket de duel ───────────────────────────
  if(customId==='open_duel_ticket'){
    // Vérifier si déjà un ticket ouvert
    const existing=[...activeTickets.values()].find(t=>t.challenger.id===user.id);
    if(existing){
      return interaction.reply({content:'❌ Tu as déjà un ticket de duel ouvert !',ephemeral:true});
    }

    // Trouver ou créer la catégorie
    let cat=guild.channels.cache.find(c=>c.name===TICKET_CATEGORY_NAME&&c.type===ChannelType.GuildCategory);
    if(!cat){
      cat=await guild.channels.create({
        name:TICKET_CATEGORY_NAME,
        type:ChannelType.GuildCategory,
        permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]}]
      });
    }

    // Créer le salon ticket
    const ticketChannel=await guild.channels.create({
      name:`duel-${user.username}`.toLowerCase().replace(/\s/g,'-'),
      type:ChannelType.GuildText,
      parent:cat.id,
      permissionOverwrites:[
        {id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},
        {id:user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
        {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ReadMessageHistory]},
      ]
    });

    activeTickets.set(ticketChannel.id,{challenger:user,challenged:null,guildId:guild.id});

    const db=loadDB();
    const p=getPlayer(db,user.id,user.username);
    saveDB(db);
    const rank=getRank(p.xp);

    const embed=new EmbedBuilder()
      .setTitle('🎮 Ticket de Duel')
      .setColor(0x44aaff)
      .setDescription(
        `Bienvenue **${user.username}** (${rank.name}) !\n\n` +
        `**Pour lancer un duel :**\n` +
        `→ Tape \`!défier @joueur\` pour défier quelqu'un\n\n` +
        `**Pendant le duel :**\n` +
        `→ Clique sur **Jouer** pour ouvrir le jeu\n` +
        `→ Crée une salle et partage le code ici\n` +
        `→ Tape \`!victoire\` quand tu gagnes\n\n` +
        `→ Tape \`!fermer\` pour fermer ce ticket`
      )
      .setFooter({text:'ArenaForge — Forge ta légende !'});

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🕹️ Jouer à ArenaForge').setStyle(ButtonStyle.Link).setURL(GAME_URL),
      new ButtonBuilder().setCustomId(`close_ticket_${ticketChannel.id}`).setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({content:`${user}`,embeds:[embed],components:[row]});
    return interaction.reply({content:`✅ Ton ticket a été créé : ${ticketChannel} !`,ephemeral:true});
  }

  // ── Classement depuis bouton ───────────────────────────
  if(customId==='show_leaderboard'){
    const db=loadDB();
    const sorted=Object.entries(db).sort(([,a],[,b])=>b.xp-a.xp).slice(0,10);
    const medals=['🥇','🥈','🥉'];
    const lines=sorted.map(([,p],i)=>`${medals[i]||`**${i+1}.**`} ${getRank(p.xp).name.split(' ')[0]} **${p.username}** — ${p.xp} XP`);
    const embed=new EmbedBuilder().setTitle('🏆 Classement ArenaForge').setColor(0xFFD700)
      .setDescription(lines.length?lines.join('\n'):'Aucun joueur encore !');
    return interaction.reply({embeds:[embed],ephemeral:true});
  }

  // ── Accepter un duel ───────────────────────────────────
  if(customId.startsWith('accept_duel_')){
    const channelId=customId.replace('accept_duel_','');
    const ticket=activeTickets.get(channelId);
    if(!ticket)return interaction.reply({content:'❌ Ticket introuvable.',ephemeral:true});
    if(user.id!==ticket.challenged?.id)return interaction.reply({content:'❌ Ce défi ne te concerne pas.',ephemeral:true});

    const db=loadDB();
    const pc=getPlayer(db,ticket.challenger.id,ticket.challenger.username);
    const pd=getPlayer(db,ticket.challenged.id,ticket.challenged.username);
    saveDB(db);

    const embed=new EmbedBuilder()
      .setTitle('⚔️ Duel accepté — Que le combat commence !')
      .setColor(0xff4444)
      .setDescription(
        `**${ticket.challenger.username}** (${getRank(pc.xp).name}) VS **${ticket.challenged.username}** (${getRank(pd.xp).name})\n\n` +
        `**Instructions :**\n` +
        `1️⃣ Clique sur **Jouer** ci-dessous\n` +
        `2️⃣ **${ticket.challenger.username}** crée une salle et copie le code\n` +
        `3️⃣ Colle le code ici dans ce salon\n` +
        `4️⃣ **${ticket.challenged.username}** rejoint avec le code\n` +
        `5️⃣ Le gagnant tape \`!victoire\` ici pour enregistrer\n\n` +
        `Bonne chance à vous deux ! 🔥`
      );

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('🕹️ Jouer à ArenaForge').setStyle(ButtonStyle.Link).setURL(GAME_URL),
    );

    await interaction.update({components:[]});
    return interaction.followUp({embeds:[embed],components:[row]});
  }

  // ── Refuser un duel ────────────────────────────────────
  if(customId.startsWith('refuse_duel_')){
    const channelId=customId.replace('refuse_duel_','');
    const ticket=activeTickets.get(channelId);
    if(!ticket)return interaction.reply({content:'❌ Ticket introuvable.',ephemeral:true});
    if(user.id!==ticket.challenged?.id)return interaction.reply({content:'❌ Ce défi ne te concerne pas.',ephemeral:true});

    ticket.challenged=null;
    await interaction.update({components:[]});
    return interaction.followUp(`❌ **${user.username}** a refusé le défi. Tu peux défier quelqu'un d'autre avec \`!défier @joueur\``);
  }

  // ── Fermer ticket via bouton ───────────────────────────
  if(customId.startsWith('close_ticket_')){
    const channelId=customId.replace('close_ticket_','');
    const ticket=activeTickets.get(channelId);
    const channel=guild.channels.cache.get(channelId);
    if(!channel)return interaction.reply({content:'❌ Salon introuvable.',ephemeral:true});
    if(ticket&&user.id!==ticket.challenger.id&&!member.permissions.has('Administrator'))
      return interaction.reply({content:'❌ Seul le créateur peut fermer.',ephemeral:true});

    await interaction.reply('🔒 Fermeture dans 5 secondes...');
    setTimeout(async()=>{
      activeTickets.delete(channelId);
      await channel.delete().catch(()=>{});
    },5000);
  }
});

client.login(TOKEN);
