// index.ts
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(exec);

interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

class StreamingTextToSpeech {
    private openai: OpenAI;
    private audioFolder: string;
    private currentlyPlaying: boolean;
    private audioQueue: string[];
    private processingQueue: boolean;

    constructor(openai: OpenAI, audioFolder: string) {
        this.openai = openai;
        this.audioFolder = audioFolder;
        this.currentlyPlaying = false;
        this.audioQueue = [];
        this.processingQueue = false;
    }

    private splitIntoSentences(text: string): string[] {
        // Split on periods followed by space or end of string
        return text
            .split('.')
            .map(sentence => sentence.trim())
            .filter(sentence => sentence.length > 0);
    }

    private async convertToSpeech(text: string, index: number): Promise<string> {
        const speechFile = path.join(this.audioFolder, `output_${index}.mp3`);
        
        const mp3 = await this.openai.audio.speech.create({
            model: 'tts-1',
            voice: 'alloy',
            input: text
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        fs.writeFileSync(speechFile, buffer);
        
        return speechFile;
    }

    private async playAudio(audioFile: string): Promise<void> {
        this.currentlyPlaying = true;
        try {
            await execAsync(`play ${audioFile}`);
        } finally {
            this.currentlyPlaying = false;
            // Clean up the temporary audio file
            fs.unlinkSync(audioFile);
        }
    }

    private async processNextInQueue(): Promise<void> {
        if (this.processingQueue || this.audioQueue.length === 0) return;

        this.processingQueue = true;
        while (this.audioQueue.length > 0) {
            const audioFile = this.audioQueue.shift();
            if (audioFile) {
                await this.playAudio(audioFile);
            }
        }
        this.processingQueue = false;
    }

    public async streamText(text: string): Promise<void> {
        const sentences = this.splitIntoSentences(text);
        
        // Start converting all sentences to speech immediately
        const conversionPromises = sentences.map((sentence, index) => 
            this.convertToSpeech(sentence, index)
        );

        // As each conversion completes, add it to the queue and start playing if not already playing
        for (let i = 0; i < conversionPromises.length; i++) {
            try {
                const audioFile = await conversionPromises[i];
                this.audioQueue.push(audioFile);
                
                // If this is the first sentence, start processing the queue
                if (i === 0) {
                    this.processNextInQueue();
                }
            } catch (error) {
                console.error(`Error converting sentence ${i} to speech:`, error);
            }
        }

        // Wait for all audio to finish playing
        while (this.audioQueue.length > 0 || this.currentlyPlaying) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

class VoiceSalesAssistant {
    private openai: OpenAI;
    private conversationHistory: Message[];
    private audioFolder: string;
    private isRecording: boolean;

    constructor() {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required');
        }

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.conversationHistory = [];
        this.isRecording = false;
        this.audioFolder = path.join(__dirname, 'audio');
        
        // Ensure audio directory exists
        if (!fs.existsSync(this.audioFolder)) {
            fs.mkdirSync(this.audioFolder);
        }

        this.initializeSystemPrompt();
    }

    private initializeSystemPrompt(): void {
        const systemPrompt = `You are Olivia, a professional car sales representative at OMODA, specializing in electric and hybrid vehicles.
        Your responses should be natural and conversational, suitable for speech.
        
        Vehicle Information:
        - OMODA E5 (Electric): 204bhp motor, 30-80% charging in 28 minutes
        - Current Promotion: £500 post-test drive incentive
        
        Keep responses concise and natural for voice conversation.`;

        this.conversationHistory.push({
            role: 'system',
            content: systemPrompt
        });
    }

    private async recordAudio(duration: number = 5): Promise<string> {
        const outputFile = path.join(this.audioFolder, 'input.wav');
        
        // Using sox for audio recording
        const command = `sox -d ${outputFile} trim 0 ${duration}`;
        
        console.log('🎤 Recording... (Press Ctrl+C to stop)');
        
        try {
            await execAsync(command);
            return outputFile;
        } catch (error) {
            console.error('Error recording audio:', error);
            throw error;
        }
    }

    private async speechToText(audioFile: string): Promise<string> {
        const audioStream = fs.createReadStream(audioFile);
        const transcript = await this.openai.audio.transcriptions.create({
            file: audioStream,
            model: 'whisper-1'
        });
        return transcript.text;
    }

    private async getAssistantResponse(userInput: string): Promise<string> {
        try {
            this.conversationHistory.push({ role: 'user', content: userInput });

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: this.conversationHistory,
                temperature: 0.7,
                max_tokens: 150
            });

            const assistantResponse = response.choices[0]?.message?.content || '';
            this.conversationHistory.push({ role: 'assistant', content: assistantResponse });
            return assistantResponse;
        } catch (error) {
            console.error('Error getting assistant response:', error);
            return 'I apologize, but I encountered an error. Please try again.';
        }
    }

    private async textToSpeech(text: string): Promise<void> {
        try {
            const streamingTTS = new StreamingTextToSpeech(this.openai, this.audioFolder);
            await streamingTTS.streamText(text);
        } catch (error) {
            console.error('Error in text-to-speech:', error);
            throw error;
        }
    }

    public async start(): Promise<void> {
        console.log('Starting OMODA Sales Assistant...');
        
        try {
            // Initial greeting
            const greeting = "Welcome to OMODA! I'm Olivia. How can I assist you today?";
            console.log('🤖 Assistant:', greeting);
            await this.textToSpeech(greeting);

            while (true) {
                try {
                    console.log('\nPress Enter to start recording (5 seconds)...');
                    await new Promise(resolve => process.stdin.once('data', resolve));

                    // Record audio
                    const audioFile = await this.recordAudio(5);
                    
                    // Convert speech to text
                    const userInput = await this.speechToText(audioFile);
                    console.log('🎤 Customer:', userInput);

                    // Check for exit command
                    if (userInput.toLowerCase().includes('goodbye') || 
                        userInput.toLowerCase().includes('bye')) {
                        const farewell = "Thank you for visiting OMODA! Have a great day!";
                        console.log('🤖 Assistant:', farewell);
                        await this.textToSpeech(farewell);
                        break;
                    }

                    // Get and speak assistant's response
                    const response = await this.getAssistantResponse(userInput);
                    console.log('🤖 Assistant:', response);
                    await this.textToSpeech(response);

                } catch (error) {
                    console.error('Error in conversation loop:', error);
                }
            }
        } catch (error) {
            console.error('Fatal error:', error);
        }
    }
}

// Run the application
async function main() {
    try {
        const assistant = new VoiceSalesAssistant();
        await assistant.start();
    } catch (error) {
        console.error('Error starting the voice assistant:', error);
        process.exit(1);
    }
}

main();