import { NextResponse } from 'next/server';

export function retiredFeatureResponse(feature: string) {
  return NextResponse.json(
    {
      error: `${feature} has been retired.`,
      retired: true,
      redirectTo: '/home',
    },
    { status: 410 }
  );
}
