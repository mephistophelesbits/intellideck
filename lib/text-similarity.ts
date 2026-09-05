import { Article } from './types';

// Common stop words to filter out
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'just', 'also', 'now', 'this', 'that', 'these', 'those',
  'about', 'which', 'who', 'whom', 'what', 'their', 'them', 'they',
  'its', 'it', 'his', 'her', 'he', 'she', 'you', 'your', 'we', 'our',
  'my', 'me', 'him', 'us', 'says', 'said', 'new', 'like', 'get', 'got',
  'make', 'made', 'take', 'took', 'come', 'came', 'go', 'went', 'see',
  'seen', 'know', 'known', 'think', 'thought', 'want', 'give', 'gave',
  'use', 'find', 'found', 'tell', 'told', 'ask', 'asked', 'work',
  'seem', 'feel', 'try', 'leave', 'call', 'called', 'keep', 'let',
  'begin', 'began', 'show', 'shown', 'hear', 'heard', 'play', 'run',
  'move', 'live', 'believe', 'hold', 'bring', 'happen', 'write', 'wrote',
  'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue',
  'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow',
  'stop', 'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow',
  'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider', 'appear',
  'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay',
  'fall', 'cut', 'reach', 'kill', 'remain', 'many', 'much', 'over',
  'year', 'years', 'time', 'first', 'last', 'long', 'great', 'little',
  'own', 'old', 'right', 'big', 'high', 'different', 'small', 'large',
  'next', 'early', 'young', 'important', 'public', 'bad', 'good'
]);

/**
 * Extract meaningful keywords from text
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];

  // Remove HTML tags
  const cleanText = text.replace(/<[^>]*>/g, ' ');

  // Normalize and tokenize
  const words = cleanText
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')  // Remove punctuation except hyphens
    .split(/\s+/)
    .filter(word => {
      // Filter: min 3 chars, not a number, not a stop word
      return word.length >= 3 &&
        !/^\d+$/.test(word) &&
        !STOP_WORDS.has(word);
    });

  // Count word frequency
  const wordFreq = new Map<string, number>();
  for (const word of words) {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  }

  // Sort by frequency and return top keywords
  const sorted = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);

  return sorted;
}

/**
 * Calculate similarity score between two keyword sets
 */
export function calculateSimilarity(
  keywords1: string[],
  keywords2: string[]
): { score: number; matchedKeywords: string[] } {
  if (keywords1.length === 0 || keywords2.length === 0) {
    return { score: 0, matchedKeywords: [] };
  }

  const set2 = new Set(keywords2);

  // Find intersection
  const matchedKeywords = keywords1.filter(k => set2.has(k));

  // Jaccard similarity: intersection / union
  const union = new Set([...keywords1, ...keywords2]);
  const score = matchedKeywords.length / union.size;

  return { score, matchedKeywords };
}

export interface RelatedArticle {
  article: Article;
  score: number;
  matchedKeywords: string[];
}

export interface FindRelatedOptions {
  maxResults?: number;
  minScore?: number;
  excludeIds?: string[];
}

/**
 * Find related articles from all columns based on keyword similarity
 */
export function findRelatedArticles(
  targetArticle: Article,
  allArticles: Map<string, Article[]>,
  options: FindRelatedOptions = {}
): RelatedArticle[] {
  const {
    maxResults = 5,
    minScore = 0.15,  // 15% keyword overlap minimum
    excludeIds = []
  } = options;

  // Extract keywords from target article
  const targetText = `${targetArticle.title} ${targetArticle.content || targetArticle.contentSnippet || ''}`;
  const targetKeywords = extractKeywords(targetText);

  if (targetKeywords.length === 0) {
    return [];
  }

  const excludeSet = new Set([targetArticle.id, ...excludeIds]);
  const results: RelatedArticle[] = [];

  // Iterate through all articles in all columns
  for (const [, articles] of allArticles) {
    for (const article of articles) {
      // Skip excluded articles
      if (excludeSet.has(article.id)) continue;

      // Extract keywords and calculate similarity
      const articleText = `${article.title} ${article.content || article.contentSnippet || ''}`;
      const articleKeywords = extractKeywords(articleText);
      const { score, matchedKeywords } = calculateSimilarity(targetKeywords, articleKeywords);

      // Only include if above threshold
      if (score >= minScore) {
        results.push({ article, score, matchedKeywords });
      }
    }
  }

  // Sort by score descending and limit results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Generate a search query from article for web search
 */
export function generateSearchQuery(article: Article): string {
  const keywords = extractKeywords(article.title);
  // Use top 5 keywords for search query
  return keywords.slice(0, 5).join(' ');
}
