import 'server-only';

// Shared between smart-search.ts (ranked/story-grouped search) and
// search-repository.ts (saved-rule/classic search + monitoring) so the two
// modes agree on how queries are tokenized and what counts as "breaking".
export const TERM_SPLIT_PATTERN = /[,\n;，；]+/;

export const BREAKING_TERMS = [
  'breaking', 'urgent', 'alert', 'acquires', 'funding', 'earnings', 'security', 'breach', 'outage', 'launch',
  '突发', '快讯', '紧急', '警报', '收购', '融资', '财报', '故障', '发布',
];

// Escapes SQLite LIKE wildcards (%, _) in a keyword before wrapping it as a %term% pattern,
// so a literal % or _ in a search term isn't misread as a wildcard. Pair with `LIKE ? ESCAPE '\'`.
export function toLikeParam(keyword: string) {
  return `%${keyword.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
