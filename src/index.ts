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

    private async playAudio(audioFile: string): Promise<void> {
        // Using sox for audio playback
        const command = `play ${audioFile}`;
        
        try {
            await execAsync(command);
        } catch (error) {
            console.error('Error playing audio:', error);
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

    private async textToSpeech(text: string): Promise<string> {
        try {
            const speechFile = path.join(this.audioFolder, 'output.mp3');
            
            const mp3 = await this.openai.audio.speech.create({
                model: 'tts-1',
                voice: 'alloy',
                input: text
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            fs.writeFileSync(speechFile, buffer);

            return speechFile;
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
            const greetingAudio = await this.textToSpeech(greeting);
            await this.playAudio(greetingAudio);

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
                        const farewellAudio = await this.textToSpeech(farewell);
                        await this.playAudio(farewellAudio);
                        break;
                    }

                    // Get and speak assistant's response
                    const response = await this.getAssistantResponse(userInput);
                    console.log('🤖 Assistant:', response);
                    const responseAudio = await this.textToSpeech(response);
                    await this.playAudio(responseAudio);

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