const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Database file path
const DB_PATH = './db.json';

// Default voice modes and their ElevenLabs voice mappings
const VOICE_MODES = {
  'silly': 'rachel', // High-pitched, playful
  'robot': 'adam',   // Deep, robotic
  'deep': 'josh',    // Deep masculine
  'sultry': 'bella'  // Smooth feminine
};

// Rate limit in milliseconds (5 minutes)
const RATE_LIMIT_MS = 5 * 60 * 1000;

// Profanity filter - basic list (expand as needed)
const PROFANITY_LIST = [
  'fuck', 'shit', 'bitch', 'asshole', 'damn', 'cunt', 'nigger', 'faggot'
  // Add more as needed - this is intentionally basic for the starter
];

/**
 * Initialize database with default structure
 */
async function initDB() {
  const defaultDB = {
    users: {}, // userId: { allowRoasts: boolean, lastRoasted: timestamp }
    groups: {}, // groupId: { safeMode: boolean, nuclearOk: boolean, defaultVoiceMode: string, admins: [] }
    cooldowns: {}, // userId: { lastRoastTime: timestamp }
    roastLog: [] // { timestamp, targetUserId, issuerUserId, tier, groupId }
  };

  if (!await fs.pathExists(DB_PATH)) {
    await fs.writeJson(DB_PATH, defaultDB, { spaces: 2 });
    console.log('Database initialized');
  }
}

/**
 * Load database
 */
async function loadDB() {
  try {
    return await fs.readJson(DB_PATH);
  } catch (error) {
    console.error('Error loading database:', error);
    return null;
  }
}

/**
 * Save database
 */
async function saveDB(db) {
  try {
    await fs.writeJson(DB_PATH, db, { spaces: 2 });
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

/**
 * Check if user is group admin
 */
async function isGroupAdmin(ctx, userId) {
  try {
    const admins = await ctx.getChatAdministrators();
    return admins.some(admin => admin.user.id === userId);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

/**
 * Load roasts from file
 */
async function loadRoasts(tier) {
  try {
    const filename = `roasts_${tier}.txt`;
    const content = await fs.readFile(filename, 'utf8');
    return content.split('\n').filter(line => line.trim().length > 0);
  } catch (error) {
    console.error(`Error loading roasts for tier ${tier}:`, error);
    return [];
  }
}

/**
 * Check profanity filter
 */
function containsProfanity(text) {
  const lowercaseText = text.toLowerCase();
  return PROFANITY_LIST.some(word => lowercaseText.includes(word));
}

/**
 * Generate TTS audio using ElevenLabs HTTP API and convert to OGG
 */
async function generateVoiceRoast(text, voiceMode = 'silly') {
  const tempDir = './temp';
  await fs.ensureDir(tempDir);
  
  const tempMp3 = path.join(tempDir, `roast_${Date.now()}.mp3`);
  const tempOgg = path.join(tempDir, `roast_${Date.now()}.ogg`);

  try {
    // Get voice ID from mode (fallback to default voice)
    const voiceId = process.env.DEFAULT_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Default to Adam
    
    console.log(`Generating TTS with voice ${voiceId} for text: ${text.substring(0, 50)}...`);

    // Make HTTP request to ElevenLabs API
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text: text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      },
      {
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVENLABS_API_KEY
        },
        responseType: 'arraybuffer'
      }
    );

    // Save MP3 to temp file
    await fs.writeFile(tempMp3, response.data);

    // Convert MP3 to OGG/OPUS using ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3)
        .audioCodec('libopus')
        .format('ogg')
        .on('end', resolve)
        .on('error', reject)
        .save(tempOgg);
    });

    // Read the OGG file
    const oggBuffer = await fs.readFile(tempOgg);
    
    // Cleanup temp files
    await fs.remove(tempMp3);
    await fs.remove(tempOgg);

    return oggBuffer;

  } catch (error) {
    console.error('Error generating voice roast:', error);
    // Cleanup on error
    try {
      await fs.remove(tempMp3);
      await fs.remove(tempOgg);
    } catch (cleanupError) {
      console.error('Error cleaning up temp files:', cleanupError);
    }
    throw error;
  }
}

/**
 * Get available ElevenLabs voices
 */
async function getElevenLabsVoices() {
  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    });
    return response.data.voices;
  } catch (error) {
    console.error('Error fetching voices:', error);
    throw error;
  }
}

/**
 * Log roast event
 */
async function logRoastEvent(targetUserId, issuerUserId, tier, groupId) {
  const db = await loadDB();
  if (!db) return;

  db.roastLog.push({
    timestamp: Date.now(),
    targetUserId,
    issuerUserId,
    tier,
    groupId
  });

  // Keep only last 100 entries
  if (db.roastLog.length > 100) {
    db.roastLog = db.roastLog.slice(-100);
  }

  await saveDB(db);
}

// Command handlers

/**
 * /start command
 */
bot.start((ctx) => {
  ctx.reply(
    '🎤 Welcome to Voice Roaster Bot! 🔥\n\n' +
    'I can generate funny voice note roasts for your friend group.\n\n' +
    'Commands:\n' +
    '• /allow_roast - Opt in to receive roasts\n' +
    '• /stop_roasts - Opt out of roasts\n' +
    '• /voiceroast [tier] [mode] - Roast someone (reply to their message)\n' +
    '• /safemode on/off - Admin: toggle profanity filter\n' +
    '• /listvoices - Admin: show available voices\n' +
    '• /roastlog - Admin: show recent roast activity\n\n' +
    'Tiers: tame, spicy, nuclear\n' +
    'Voice modes: silly, robot, deep, sultry\n\n' +
    '⚠️ You must opt-in with /allow_roast before you can be roasted!'
  );
});

/**
 * /allow_roast command - User opt-in
 */
bot.command('allow_roast', async (ctx) => {
  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  const userId = ctx.from.id;
  
  if (!db.users[userId]) {
    db.users[userId] = {};
  }
  
  db.users[userId].allowRoasts = true;
  await saveDB(db);

  ctx.reply('✅ You\'ve opted in to receive roasts! You can now be targeted with /voiceroast.\n\nUse /stop_roasts if you change your mind.');
});

/**
 * /stop_roasts command - User opt-out
 */
bot.command('stop_roasts', async (ctx) => {
  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  const userId = ctx.from.id;
  
  if (!db.users[userId]) {
    db.users[userId] = {};
  }
  
  db.users[userId].allowRoasts = false;
  await saveDB(db);

  ctx.reply('🛡️ You\'ve opted out of roasts. You won\'t be targeted until you use /allow_roast again.');
});

/**
 * /safemode command - Admin toggle for profanity filter
 */
bot.command('safemode', async (ctx) => {
  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  // Check if user is admin
  if (!await isGroupAdmin(ctx, userId)) {
    return ctx.reply('❌ Only group admins can change safemode settings.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 2 || !['on', 'off'].includes(args[1])) {
    return ctx.reply('Usage: /safemode on|off');
  }

  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  if (!db.groups[groupId]) {
    db.groups[groupId] = {};
  }

  const safeMode = args[1] === 'on';
  db.groups[groupId].safeMode = safeMode;
  await saveDB(db);

  ctx.reply(`🔒 Safemode ${safeMode ? 'ENABLED' : 'DISABLED'}. ${safeMode ? 'Profanity will be filtered.' : 'Profanity filter disabled.'}`);
});

/**
 * /voiceroast command - Generate voice roast
 */
bot.command('voiceroast', async (ctx) => {
  // Must be a reply to another message
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ You must reply to someone\'s message to roast them!\n\nUsage: Reply to a message and type /voiceroast [tier] [mode]');
  }

  const targetUser = ctx.message.reply_to_message.from;
  const targetUserId = targetUser.id;
  const issuerUserId = ctx.from.id;
  const groupId = ctx.chat.id;

  // Parse arguments
  const args = ctx.message.text.split(' ').slice(1); // Remove /voiceroast
  const tier = args[0] || 'tame';
  const voiceMode = args[1] || 'silly';

  // Validate tier
  if (!['tame', 'spicy', 'nuclear'].includes(tier)) {
    return ctx.reply('❌ Invalid tier! Use: tame, spicy, or nuclear');
  }

  // Validate voice mode
  if (!['silly', 'robot', 'deep', 'sultry'].includes(voiceMode)) {
    return ctx.reply('❌ Invalid voice mode! Use: silly, robot, deep, or sultry');
  }

  // Load database
  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  // Check if target user has opted in
  if (!db.users[targetUserId] || !db.users[targetUserId].allowRoasts) {
    return ctx.reply(`❌ @${targetUser.username || targetUser.first_name} hasn't opted in to receive roasts!\n\nThey need to use /allow_roast first.`);
  }

  // Check nuclear tier requirements
  if (tier === 'nuclear') {
    if (!db.groups[groupId] || !db.groups[groupId].nuclearOk) {
      return ctx.reply('❌ Nuclear roasts are disabled in this group. An admin needs to enable them first.');
    }
  }

  // Check rate limit
  const lastRoastTime = db.cooldowns[issuerUserId]?.lastRoastTime || 0;
  const timeSinceLastRoast = Date.now() - lastRoastTime;
  
  if (timeSinceLastRoast < RATE_LIMIT_MS) {
    const remainingTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRoast) / 1000 / 60);
    return ctx.reply(`⏰ Slow down! You can roast again in ${remainingTime} minutes.`);
  }

  try {
    // Load roasts for the tier
    const roasts = await loadRoasts(tier);
    if (roasts.length === 0) {
      return ctx.reply(`❌ No roasts available for tier: ${tier}`);
    }

    // Select random roast
    const selectedRoast = roasts[Math.floor(Math.random() * roasts.length)];

    // Check profanity filter
    if (db.groups[groupId]?.safeMode && containsProfanity(selectedRoast)) {
      console.log(`Blocked profanity in roast: ${selectedRoast}`);
      return ctx.reply('🚫 That roast contains profanity and safemode is enabled. Try again or ask an admin to disable safemode.');
    }

    // Generate voice roast
    ctx.reply('🎤 Generating your voice roast...');
    const audioBuffer = await generateVoiceRoast(selectedRoast, voiceMode);

    // Send voice message
    await ctx.replyWithVoice({ source: audioBuffer }, {
      reply_to_message_id: ctx.message.reply_to_message.message_id
    });

    // Update cooldown
    if (!db.cooldowns[issuerUserId]) {
      db.cooldowns[issuerUserId] = {};
    }
    db.cooldowns[issuerUserId].lastRoastTime = Date.now();

    // Log the event
    await logRoastEvent(targetUserId, issuerUserId, tier, groupId);
    await saveDB(db);

  } catch (error) {
    console.error('Error generating roast:', error);
    ctx.reply('❌ Sorry, there was an error generating your roast. Please try again later.');
  }
});

/**
 * /listvoices command - Admin only, list ElevenLabs voices
 */
bot.command('listvoices', async (ctx) => {
  const userId = ctx.from.id;

  // Check if user is admin
  if (!await isGroupAdmin(ctx, userId)) {
    return ctx.reply('❌ Only group admins can list voices.');
  }

  try {
    const voices = await getElevenLabsVoices();
    
    let voiceList = '🎤 Available ElevenLabs Voices:\n\n';
    voices.forEach(voice => {
      voiceList += `• ${voice.name} (${voice.voice_id})\n`;
    });

    voiceList += '\n💡 Set DEFAULT_VOICE_ID in your .env file to change the default voice.';
    
    ctx.reply(voiceList);

  } catch (error) {
    console.error('Error fetching voices:', error);
    ctx.reply('❌ Error fetching voice list from ElevenLabs.');
  }
});

/**
 * /roastlog command - Admin only, show recent roast activity
 */
bot.command('roastlog', async (ctx) => {
  const userId = ctx.from.id;
  const groupId = ctx.chat.id;

  // Check if user is admin
  if (!await isGroupAdmin(ctx, userId)) {
    return ctx.reply('❌ Only group admins can view the roast log.');
  }

  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  // Filter logs for this group and get last 10
  const groupLogs = db.roastLog
    .filter(log => log.groupId === groupId)
    .slice(-10)
    .reverse();

  if (groupLogs.length === 0) {
    return ctx.reply('📝 No roast activity recorded for this group yet.');
  }

  let logMessage = '📝 Recent Roast Activity:\n\n';
  
  for (const log of groupLogs) {
    const date = new Date(log.timestamp).toLocaleString();
    logMessage += `• ${date}\n`;
    logMessage += `  Target: ${log.targetUserId}\n`;
    logMessage += `  Issuer: ${log.issuerUserId}\n`;
    logMessage += `  Tier: ${log.tier}\n\n`;
  }

  ctx.reply(logMessage);
});

/**
 * /set_voice_mode command - Admin sets default voice mode for group
 */
bot.command('set_voice_mode', async (ctx) => {
  const userId = ctx.from.id;
  const groupId = ctx.chat.id;

  // Check if user is admin
  if (!await isGroupAdmin(ctx, userId)) {
    return ctx.reply('❌ Only group admins can set the default voice mode.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 2 || !['silly', 'robot', 'deep', 'sultry'].includes(args[1])) {
    return ctx.reply('Usage: /set_voice_mode <mode>\n\nAvailable modes: silly, robot, deep, sultry');
  }

  const voiceMode = args[1];
  const db = await loadDB();
  if (!db) return ctx.reply('Database error occurred.');

  if (!db.groups[groupId]) {
    db.groups[groupId] = {};
  }

  db.groups[groupId].defaultVoiceMode = voiceMode;
  await saveDB(db);

  ctx.reply(`🎤 Default voice mode set to: ${voiceMode}`);
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply('An unexpected error occurred. Please try again.');
});

// Initialize and start bot
async function startBot() {
  try {
    await initDB();
    console.log('Voice Roaster Bot starting...');
    
    // Test ElevenLabs API connection
    try {
      console.log('Testing ElevenLabs API connection...');
      const voices = await getElevenLabsVoices();
      console.log(`✅ ElevenLabs API working. Found ${voices.length} voices.`);
    } catch (error) {
      console.log('⚠️  ElevenLabs API test failed:', error.message);
      console.log('Bot will still start, but voice generation may not work.');
    }
    
    // Start polling
    bot.launch();
    console.log('Bot is running!');

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));

  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
startBot();
