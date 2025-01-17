import { VoiceConnection } from '@discordjs/voice';

export interface AudioQueue {
    connection: VoiceConnection;
    audioChunks: Buffer[];
}

export interface BotConfig {
    token: string;
    prefix: string;
}