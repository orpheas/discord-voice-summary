import { 
  Client, 
  GatewayIntentBits, 
  Message, 
  VoiceBasedChannel
} from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioReceiveStream,
  VoiceConnectionStatus,
  EndBehaviorType,
  getVoiceConnection
} from '@discordjs/voice';
import { pipeline } from 'stream/promises';
import Configuration, { OpenAI } from 'openai';
import * as prism from 'prism-media';
import { AudioQueue, BotConfig } from './types';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import OpusScript from 'opusscript';

export class VoiceBot {
  private client: Client;
  private audioQueues: Map<string, AudioQueue>;
  private openai: OpenAI;
  private config: BotConfig;

  constructor(config: BotConfig) {
      this.client = new Client({
          intents: [
              GatewayIntentBits.Guilds,
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.MessageContent,
              GatewayIntentBits.GuildVoiceStates,
          ],
      });

      this.config = config;
      this.audioQueues = new Map();

      // Initialize OpenAI
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      this.setupEventListeners();
  }

  private setupEventListeners(): void {
      this.client.on('ready', () => {
          console.log(`Logged in as ${this.client.user?.tag}`);
      });

      this.client.on('messageCreate', this.handleMessage.bind(this));
  }

  private async handleMessage(message: Message): Promise<void> {
      if (!message.content.startsWith(this.config.prefix) || message.author.bot) return;

      const args = message.content.slice(this.config.prefix.length).trim().split(/ +/);
      const command = args.shift()?.toLowerCase();

      switch (command) {
          case 'join':
              await this.handleJoinCommand(message);
              break;
          case 'leave':
              await this.handleLeaveCommand(message);
              break;
      }
  }

  private async handleJoinCommand(message: Message): Promise<void> {
      const voiceChannel = message.member?.voice.channel as VoiceBasedChannel;
      
      if (!voiceChannel) {
          await message.reply('You need to be in a voice channel first!');
          return;
      }

      try {
          const connection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: voiceChannel.guild.id,
              adapterCreator: voiceChannel.guild.voiceAdapterCreator,
              selfDeaf: false,
          });

          // Initialize audio queue
          this.audioQueues.set(voiceChannel.guild.id, {
              connection,
              audioChunks: [],
          });

          // Set up audio recording
          connection.receiver.speaking.on('start', (userId) => {
              const audioStream = connection.receiver.subscribe(userId, {
                  end: {
                      behavior: EndBehaviorType.AfterSilence,
                      duration: 100,
                  },
              });

              this.handleAudioStream(audioStream, voiceChannel.guild.id);
          });

          await message.reply('Joined voice channel and started recording.');
      } catch (error) {
          console.error('Error joining voice channel:', error);
          await message.reply('Failed to join voice channel.');
      }
  }

  private async handleAudioStream(audioStream: AudioReceiveStream, guildId: string): Promise<void> {
    const queue = this.audioQueues.get(guildId);
    if (!queue) return;

    try {
        console.log('Starting new audio stream');
        const decoder = new OpusScript(48000, 2);
        
        for await (const chunk of audioStream) {
            if (chunk instanceof Buffer) {
                try {
                    // Log original chunk size
                    console.log(`Original chunk size: ${chunk.length} bytes`);
                    
                    const decoded = decoder.decode(chunk);
                    if (decoded && decoded.length > 0) {
                        // Only store the actual audio data, not the entire buffer
                        const audioData = Buffer.from(decoded);
                        queue.audioChunks.push(audioData);
                        
                        // Log accumulated size
                        const totalSize = queue.audioChunks.reduce((acc, buf) => acc + buf.length, 0);
                        console.log(`Total audio size: ${totalSize / 1024} KB`);
                    }
                } catch (e) {
                    console.warn('Error decoding audio chunk:', e);
                }
            }
        }
        
        decoder.delete();
    } catch (error) {
        console.error('Error in audio stream handling:', error);
    }
}

private async handleLeaveCommand(message: Message): Promise<void> {
  const guildId = message.guild?.id;
  if (!guildId) return;

  const queue = this.audioQueues.get(guildId);
  if (!queue) {
      await message.reply('Not currently in a voice channel.');
      return;
  }

  try {
      // Stop recording and disconnect
      queue.connection.destroy();
      
      if (queue.audioChunks.length > 0) {
          const filename = `recording_${guildId}.wav`;
          const wavBuffer = this.createWavBuffer(Buffer.concat(queue.audioChunks));
          await fs.writeFile(filename, wavBuffer);

          try {
              // Get transcription but don't send it
              const transcription = await this.transcribeAudio(filename);
              if (transcription && transcription !== 'Failed to transcribe audio') {
                  // Only create and send the summary
                  const summary = await this.summarizeText(transcription); 
                  if (message.channel && 'send' in message.channel) {
                  await message.channel.send(`📝 **Summary of the conversation:**\n${summary}`);}
              } else { if (message.channel && 'send' in message.channel) {
                  await message.channel.send('No clear speech detected in the recording.');
                }
              }
          } finally {
              // Cleanup
              await fs.unlink(filename).catch(console.error);
          }
      } else {
          await message.reply('No audio was recorded.');
      }

      this.audioQueues.delete(guildId);
      await message.reply('Left voice channel.');
  } catch (error) {
      console.error('Error processing recording:', error);
      await message.reply('Failed to process recording.');
  }
}

private createWavBuffer(audioBuffer: Buffer): Buffer {
    // Set proper WAV header values for 48kHz stereo 16-bit audio
    const numChannels = 2;
    const sampleRate = 48000;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;

    const wavHeader = Buffer.alloc(44);
    
    // RIFF identifier
    wavHeader.write('RIFF', 0);
    // File length minus RIFF header
    wavHeader.writeUInt32LE(36 + audioBuffer.length, 4);
    // WAVE identifier
    wavHeader.write('WAVE', 8);
    // Format chunk marker
    wavHeader.write('fmt ', 12);
    // Format chunk length
    wavHeader.writeUInt32LE(16, 16);
    // Sample format (PCM)
    wavHeader.writeUInt16LE(1, 20);
    // Channel count
    wavHeader.writeUInt16LE(numChannels, 22);
    // Sample rate
    wavHeader.writeUInt32LE(sampleRate, 24);
    // Byte rate
    wavHeader.writeUInt32LE(byteRate, 28);
    // Block align
    wavHeader.writeUInt16LE(blockAlign, 32);
    // Bits per sample
    wavHeader.writeUInt16LE(bitsPerSample, 34);
    // Data marker
    wavHeader.write('data', 36);
    // Data length
    wavHeader.writeUInt32LE(audioBuffer.length, 40);

    console.log('WAV header created with:', {
        channels: numChannels,
        sampleRate,
        bitsPerSample,
        dataSize: audioBuffer.length
    });

    return Buffer.concat([wavHeader, audioBuffer]);
}

  private async transcribeAudio(filename: string): Promise<string> {
    try {
        // Verify file exists and has content
        const stats = await fs.stat(filename);
        if (stats.size === 0) {
            return 'No audio content recorded';
        }

        // Add timeout and retry logic
        const maxRetries = 3;
        let lastError;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await this.openai.audio.transcriptions.create({
                    file: fsSync.createReadStream(filename),
                    model: 'whisper-1'
                });
                return response.text;
            } catch (error) {
                lastError = error;
                if (i < maxRetries - 1) {
                    // Wait before retrying (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                    continue;
                }
            }
        }

        console.error('Final transcription error:', lastError);
        return 'Failed to transcribe audio after multiple attempts';
    } catch (error) {
        console.error('Error in transcription process:', error);
        return 'Error processing audio file';
    }
}

  private async summarizeText(text: string): Promise<string> {
      if (text.split(' ').length < 30) {
          return 'Text too short to summarize meaningfully';
      }

      try {
          const response = await this.openai.chat.completions.create({
              model: 'gpt-4o',  // Fixed typo in model name
              messages: [
                  {
                      role: 'system',
                      content: 'Please summarize the following text concisely:'
                  },
                  {
                      role: 'user',
                      content: text
                  }
              ]
          });

          return response.choices[0]?.message?.content || 'Failed to generate summary';
      } catch (error) {
          console.error('Error summarizing text:', error);
          return 'Failed to generate summary';
      }
  }

  public start(): void {
      this.client.login(this.config.token);
  }
}