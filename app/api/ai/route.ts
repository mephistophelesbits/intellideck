import { retiredFeatureResponse } from '@/lib/server/retired-feature';

export async function POST() {
  return retiredFeatureResponse('AI reading');
}

export async function GET() {
  return retiredFeatureResponse('AI reading');
}
