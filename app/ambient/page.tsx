import { AmbientWallPrototype } from '@/components/prototypes/AmbientWallPrototype';
import { AppChrome } from '@/components/AppChrome';

export default function AmbientPage() {
  return (
    <AppChrome showAddFeedAction={false}>
      <AmbientWallPrototype embedded />
    </AppChrome>
  );
}
