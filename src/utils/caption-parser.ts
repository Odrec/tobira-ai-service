/**
 * VTT/SRT Caption Parser
 * Uses @plussub/srt-vtt-parser for reliable parsing
 */

import { parse } from '@plussub/srt-vtt-parser';

export interface CaptionCue {
    startTime: number; // milliseconds
    endTime: number;   // milliseconds
    text: string;
}

export interface ParsedCaption {
    format: 'vtt' | 'srt' | 'unknown';
    cues: CaptionCue[];
    fullText: string;
    totalDuration: number; // milliseconds
}

/**
 * Parse caption file content (auto-detects SRT or VTT format)
 */
export function parseCaption(content: string): ParsedCaption {
    try {
        const result = parse(content);
        
        // Convert library format to our format
        const cues: CaptionCue[] = result.entries.map(entry => ({
            startTime: entry.from,
            endTime: entry.to,
            text: entry.text
        }));
        
        const fullText = cues.map(c => c.text).join(' ');
        const totalDuration = cues.length > 0 ? Math.max(...cues.map(c => c.endTime)) : 0;
        
        return {
            format: content.toUpperCase().includes('WEBVTT') ? 'vtt' : 'srt',
            cues,
            fullText,
            totalDuration
        };
    } catch (error) {
        console.error('Failed to parse caption:', error);
        return {
            format: 'unknown',
            cues: [],
            fullText: '',
            totalDuration: 0
        };
    }
}

/**
 * Extract time-segmented text for better AI processing
 * Groups cues by time segments (default: 5 minute chunks)
 */
export function segmentCaptions(
    cues: CaptionCue[], 
    segmentDuration: number = 300000 // 5 minutes in ms
): Array<{ startTime: number; endTime: number; text: string }> {
    if (cues.length === 0) return [];
    
    const segments: Array<{ startTime: number; endTime: number; text: string }> = [];
    let currentSegment: CaptionCue[] = [];
    let segmentStart = 0;
    
    for (const cue of cues) {
        if (cue.startTime >= segmentStart + segmentDuration && currentSegment.length > 0) {
            // Start new segment
            segments.push({
                startTime: segmentStart,
                endTime: currentSegment[currentSegment.length - 1].endTime,
                text: currentSegment.map(c => c.text).join(' ')
            });
            currentSegment = [];
            segmentStart = cue.startTime;
        }
        currentSegment.push(cue);
    }
    
    // Add final segment
    if (currentSegment.length > 0) {
        segments.push({
            startTime: segmentStart,
            endTime: currentSegment[currentSegment.length - 1].endTime,
            text: currentSegment.map(c => c.text).join(' ')
        });
    }
    
    return segments;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}