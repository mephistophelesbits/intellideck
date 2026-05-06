import { AmbientWallPrototype } from '@/components/prototypes/AmbientWallPrototype';
import { AppChrome } from '@/components/AppChrome';

export default function AmbientPage() {
  return (
    <AppChrome>
      <AmbientWallPrototype embedded />
    </AppChrome>
  );
}
