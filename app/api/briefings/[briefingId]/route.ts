import { retiredFeatureResponse } from '@/lib/server/retired-feature';

export async function GET() {
  return retiredFeatureResponse('Briefing detail');
}

export async function DELETE() {
  return retiredFeatureResponse('Briefing deletion');
}
