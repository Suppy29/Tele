#!/usr/bin/env node

/**
 * Smoke test for Voice Roaster Bot
 * Tests basic functionality without making actual API calls
 */

const fs = require('fs-extra');
const path = require('path');

console.log('🧪 Starting Voice Roaster Bot smoke tests...\n');

let testsPassed = 0;
let testsFailed = 0;

function test(description, testFn) {
  try {
    testFn();
    console.log(`✅ ${description}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${description}: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Test 1: Check required files exist
test('Required files exist', () => {
  const requiredFiles = [
    'package.json',
    'index.js',
    '.env.example',
    'db.json',
    'roasts_tame.txt',
    'roasts_spicy.txt',
    'roasts_nuclear_placeholders.txt',
    'README.md',
    'Dockerfile'
  ];

  requiredFiles.forEach(file => {
    assert(fs.existsSync(file), `Missing required file: ${file}`);
  });
});

// Test 2: Validate package.json
test('package.json is valid', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  assert(pkg.name === 'voice-roaster-bot', 'Package name should be voice-roaster-bot');
  assert(pkg.main === 'index.js', 'Main file should be index.js');
  assert(pkg.dependencies.telegraf, 'Should have telegraf dependency');
  assert(pkg.dependencies.dotenv, 'Should have dotenv dependency');
  assert(pkg.dependencies.axios, 'Should have axios dependency');
  assert(pkg.dependencies['fluent-ffmpeg'], 'Should have fluent-ffmpeg dependency');
});

// Test 3: Validate .env.example
test('.env.example contains required variables', () => {
  const envExample = fs.readFileSync('.env.example', 'utf8');
  
  assert(envExample.includes('TELEGRAM_BOT_TOKEN'), 'Should include TELEGRAM_BOT_TOKEN');
  assert(envExample.includes('ELEVENLABS_API_KEY'), 'Should include ELEVENLABS_API_KEY');
  assert(envExample.includes('DEFAULT_VOICE_ID'), 'Should include DEFAULT_VOICE_ID');
});

// Test 4: Validate database structure
test('db.json has correct structure', () => {
  const db = JSON.parse(fs.readFileSync('db.json', 'utf8'));
  
  assert(typeof db.users === 'object', 'Should have users object');
  assert(typeof db.groups === 'object', 'Should have groups object');
  assert(typeof db.cooldowns === 'object', 'Should have cooldowns object');
  assert(Array.isArray(db.roastLog), 'Should have roastLog array');
});

// Test 5: Validate roast files have content
test('Roast files contain content', () => {
  const tameRoasts = fs.readFileSync('roasts_tame.txt', 'utf8').trim().split('\n');
  const spicyRoasts = fs.readFileSync('roasts_spicy.txt', 'utf8').trim().split('\n');
  
  assert(tameRoasts.length >= 8, 'Should have at least 8 tame roasts');
  assert(spicyRoasts.length >= 8, 'Should have at least 8 spicy roasts');
  assert(tameRoasts[0].length > 10, 'Roasts should not be empty');
  assert(spicyRoasts[0].length > 10, 'Roasts should not be empty');
});

// Test 6: Validate nuclear placeholders are actually placeholders
test('Nuclear roasts are placeholders only', () => {
  const nuclearContent = fs.readFileSync('roasts_nuclear_placeholders.txt', 'utf8');
  
  assert(nuclearContent.includes('PLACEHOLDER'), 'Should contain placeholder text');
  assert(nuclearContent.includes('WARNING'), 'Should contain warning text');
  assert(!nuclearContent.toLowerCase().includes('fuck'), 'Should not contain explicit content');
});

// Test 7: Check index.js syntax and basic structure
test('index.js has valid syntax', () => {
  const indexContent = fs.readFileSync('index.js', 'utf8');
  
  // Basic syntax validation
  assert(indexContent.includes('require(\'telegraf\')'), 'Should import telegraf');
  assert(indexContent.includes('require(\'dotenv\')'), 'Should import dotenv');
  assert(indexContent.includes('bot.command('), 'Should define bot commands');
  assert(indexContent.includes('/allow_roast'), 'Should have allow_roast command');
  assert(indexContent.includes('/voiceroast'), 'Should have voiceroast command');
  assert(indexContent.includes('/safemode'), 'Should have safemode command');
});

// Test 8: Dockerfile validation
test('Dockerfile is properly structured', () => {
  const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
  
  assert(dockerfile.includes('FROM node:'), 'Should use Node.js base image');
  assert(dockerfile.includes('ffmpeg'), 'Should install ffmpeg');
  assert(dockerfile.includes('npm ci'), 'Should install dependencies');
  assert(dockerfile.includes('WORKDIR'), 'Should set working directory');
});

// Test 9: Check if temp directory handling is implemented
test('Temp directory handling is implemented', () => {
  const indexContent = fs.readFileSync('index.js', 'utf8');
  
  assert(indexContent.includes('./temp'), 'Should use temp directory');
  assert(indexContent.includes('fs.ensureDir'), 'Should ensure temp directory exists');
  assert(indexContent.includes('fs.remove'), 'Should clean up temp files');
});

// Test 10: Environment variable validation helper
test('Environment variables are properly used', () => {
  const indexContent = fs.readFileSync('index.js', 'utf8');
  
  assert(indexContent.includes('process.env.TELEGRAM_BOT_TOKEN'), 'Should use bot token from env');
  assert(indexContent.includes('process.env.ELEVENLABS_API_KEY'), 'Should use ElevenLabs key from env');
  assert(indexContent.includes('process.env.DEFAULT_VOICE_ID'), 'Should use voice ID from env');
});

// Test 11: Safety features validation
test('Safety features are implemented', () => {
  const indexContent = fs.readFileSync('index.js', 'utf8');
  
  assert(indexContent.includes('allowRoasts'), 'Should check user consent');
  assert(indexContent.includes('safeMode'), 'Should implement safe mode');
  assert(indexContent.includes('RATE_LIMIT'), 'Should implement rate limiting');
  assert(indexContent.includes('PROFANITY_LIST'), 'Should have profanity filter');
});

// Summary
console.log('\n🏁 Test Summary:');
console.log(`✅ Tests passed: ${testsPassed}`);
console.log(`❌ Tests failed: ${testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 All smoke tests passed! The bot should be ready to run.');
  console.log('\n📋 Next steps:');
  console.log('1. Copy .env.example to .env and fill in your API keys');
  console.log('2. Install dependencies: npm install');
  console.log('3. Make sure FFmpeg is installed');
  console.log('4. Run the bot: npm start');
  process.exit(0);
} else {
  console.log('\n💥 Some tests failed. Please fix the issues before running the bot.');
  process.exit(1);
}