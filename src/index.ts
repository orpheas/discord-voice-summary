import { config } from 'dotenv';
import { VoiceBot } from './bot';
import { BotConfig } from './types';

config();

const botConfig: BotConfig = {
  token: process.env.DISCORD_TOKEN || '',
  prefix: '!',
};

const bot = new VoiceBot(botConfig);
bot.start();