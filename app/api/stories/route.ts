import { retiredFeatureResponse } from '@/lib/server/retired-feature';

export async function GET() {
  return retiredFeatureResponse('Stories');
}
