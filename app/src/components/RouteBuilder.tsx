import type { IconName } from './Icon';
import type { StageIcon } from '@shared/routes';

/**
 * What is left of the classic stage-box route builder: the icon each stage
 * type draws with. Routes are written in the Studio now (RouteStudioPage);
 * the buyer's timeline (`Ladder`) and the Studio's starting cards still read
 * stage icons from here.
 */

/** Which drawn icon and hue each stage type gets. The six brand hues, reused. */
export const STAGE_ICON_META: Record<StageIcon, { icon: IconName }> = {
  supplier: { icon: 'truck' },
  warehouse: { icon: 'box' },
  transit: { icon: 'plane' },
  customs: { icon: 'bank' },
  delivery: { icon: 'home' },
};
