export interface OptimizedPrompt {
  task: string;
  scope: string[];
  compare_previous: boolean;
  output: string;
}

export function optimizePrompt(input: string, responseStyle: string): OptimizedPrompt {
  // TODO: Use a fast local model or heuristic to parse intent
  // For MVP, simple keyword extraction
  return {
    task: input.trim(),
    scope: [],
    compare_previous: input.includes('compare'),
    output: responseStyle,
  };
}
