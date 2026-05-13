/**
 * Prompt optimizer — normalizes messy user input into structured form.
 * 
 * This is a future-phase module. Currently provides basic keyword extraction.
 * In Phase 2, this will use a lightweight local model or heuristic parser
 * to decompose user intent into structured tasks.
 */

export interface OptimizedPrompt {
  task: string;
  scope: string[];
  compare_previous: boolean;
  output: string;
}

// Keywords that indicate specific scopes
const SCOPE_KEYWORDS: Record<string, string> = {
  'auth': 'authentication',
  'login': 'authentication',
  'middleware': 'middleware',
  'api': 'api',
  'route': 'routing',
  'database': 'database',
  'db': 'database',
  'test': 'testing',
  'style': 'styling',
  'css': 'styling',
  'deploy': 'deployment',
  'build': 'build',
  'config': 'configuration',
};

export function optimizePrompt(input: string, responseStyle: string): OptimizedPrompt {
  const normalized = input.trim().toLowerCase();
  const words = normalized.split(/\s+/);

  // Extract scopes from keywords
  const scope: string[] = [];
  for (const word of words) {
    if (SCOPE_KEYWORDS[word] && !scope.includes(SCOPE_KEYWORDS[word])) {
      scope.push(SCOPE_KEYWORDS[word]);
    }
  }

  return {
    task: input.trim(),
    scope,
    compare_previous: normalized.includes('compare') || normalized.includes('diff') || normalized.includes('previous'),
    output: responseStyle,
  };
}
