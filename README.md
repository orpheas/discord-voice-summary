# Discord Voice Bot

A Discord bot that joins voice channels, records conversations, and provides summaries using OpenAI Whisper and GPT.

## Features

- Join/leave voice channels via commands
- Record voice conversations
- Transcribe audio using OpenAI's Whisper
- Generate conversation summaries using GPT-4

## Prerequisites

- Node.js 18 or higher
- Discord Bot Token
- OpenAI API Key
- pnpm (recommended) or npm

## Setup

1. Create a Discord App on the Discord Developer Portal (so you can get your discord token)
2. Clone the repository
3. Create a `.env` file in the root directory:
```
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
```
4. Install dependencies:
```
pnpm install
```
5. Build project:
```
pnpm build
```
6. Start the bot:
```
pnpm start
```
Usage
The bot responds to the following commands:

!join - Bot joins your current voice channel and starts recording
!leave - Bot leaves the voice channel and provides a summary of the conversation
