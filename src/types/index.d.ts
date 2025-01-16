declare module 'node-microphone' {
    class Mic {
        constructor(options?: any);
        startRecording(): NodeJS.ReadableStream;
        stopRecording(): void;
    }
    export default Mic;
}

declare module 'node-record-lpcm16' {
    interface RecordOptions {
        sampleRate?: number;
        channels?: number;
        audioType?: string;
        threshold?: number;
        thresholdStart?: number;
        thresholdEnd?: number;
        silence?: number;
        verbose?: boolean;
    }

    interface Recorder {
        record(options?: RecordOptions): any;
        stop(): void;
        stream(): NodeJS.ReadableStream;
    }

    export function record(options?: RecordOptions): Recorder;
}