import { retiredFeatureResponse } from '@/lib/server/retired-feature';

export async function POST() {
  return retiredFeatureResponse('Briefing chat');
}
