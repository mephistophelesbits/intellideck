import { retiredFeatureResponse } from '@/lib/server/retired-feature';

export async function POST() {
  return retiredFeatureResponse('AI summary');
}

export async function GET() {
  return retiredFeatureResponse('AI summary');
}
