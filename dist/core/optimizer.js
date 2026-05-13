export function optimizePrompt(input, responseStyle) {
    // TODO: Use a fast local model or heuristic to parse intent
    // For MVP, simple keyword extraction
    return {
        task: input.trim(),
        scope: [],
        compare_previous: input.includes('compare'),
        output: responseStyle,
    };
}
