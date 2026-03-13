import { Column, FeedSource } from './types';

export const DEFAULT_COLUMNS: Column[] = [
  {
    id: 'col-world-en',
    title: 'World News (EN)',
    type: 'unified',
    sources: [
      { id: 'bbc', url: 'http://feeds.bbci.co.uk/news/rss.xml', title: 'BBC News' },
      { id: 'reuters', url: 'https://www.reutersagency.com/feed/', title: 'Reuters' },
    ],
    settings: { refreshInterval: 10, viewMode: 'comfortable' },
    width: 350,
  },
  {
    id: 'col-tech-en',
    title: 'Tech News (EN)',
    type: 'unified',
    sources: [
      { id: 'hn', url: 'https://hnrss.org/frontpage', title: 'Hacker News' },
      { id: 'verge', url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' },
    ],
    settings: { refreshInterval: 10, viewMode: 'comfortable' },
    width: 350,
  },
  {
    id: 'col-world-zh',
    title: '世界新闻 (ZH)',
    type: 'unified',
    sources: [
      { id: 'bbc-zh', url: 'https://www.bbc.com/zhongwen/simp/index.xml', title: 'BBC 中文' },
      { id: 'zaobao', url: 'https://www.zaobao.com.sg/rss/realtime/china', title: '联合早报' },
    ],
    settings: { refreshInterval: 10, viewMode: 'comfortable' },
    width: 350,
  },
  {
    id: 'col-tech-zh',
    title: '科技资讯 (ZH)',
    type: 'unified',
    sources: [
      { id: '36kr', url: 'https://36kr.com/feed', title: '36Kr' },
      { id: 'sspai', url: 'https://sspai.com/feed', title: '少数派' },
    ],
    settings: { refreshInterval: 10, viewMode: 'comfortable' },
    width: 350,
  },
];

export const DEFAULT_SAVED_FEEDS: FeedSource[] = dedupeFeeds(
  DEFAULT_COLUMNS.flatMap((column) => column.sources)
);

function dedupeFeeds(feeds: FeedSource[]): FeedSource[] {
  const byUrl = new Map<string, FeedSource>();

  for (const feed of feeds) {
    if (!byUrl.has(feed.url)) {
      byUrl.set(feed.url, feed);
    }
  }

  return Array.from(byUrl.values());
}
