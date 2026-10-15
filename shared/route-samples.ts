import { ROUTE_PRESETS, ROUTE_TEMPLATES, STAGE_ICONS, SUGGESTED_STEPS, type RouteStep, type StageIcon } from './routes.js';

/**
 * A route every shop is offered under "New route".
 *
 * Kept by the operators in the console - added, corrected, removed - and
 * sent to every shop with its own routes, so a new sample reaches everyone
 * without a deploy. Picking one only fills the Studio in; it becomes the
 * shop's own when they save it, so editing a sample never changes a route a
 * shop already has.
 */
export interface SampleRoute {
  id: string;
  name: string;
  /** One line on what kind of journey it is, for the card that offers it. */
  blurb: string;
  icon: StageIcon;
  steps: RouteStep[];
}

/** The site content document the operators' list is kept in. */
export const ROUTE_SAMPLES_ID = 'route-samples';

/** The samples Figmark shipped with, as the console first shows them. */
export function builtInSamples(): SampleRoute[] {
  const toSteps = (id: string, steps: (typeof ROUTE_TEMPLATES)[number]['steps']): RouteStep[] =>
    steps.map((step, index) => ({ ...step, id: `${id}_${index}`, position: index }));
  return [
    ...ROUTE_TEMPLATES.map((template) => ({
      id: template.id, name: template.name, blurb: template.blurb, icon: template.icon,
      steps: toSteps(template.id, template.steps),
    })),
    ...ROUTE_PRESETS.map((preset) => ({
      id: preset.id, name: preset.name, blurb: preset.blurb, icon: 'transit' as StageIcon,
      steps: toSteps(preset.id, preset.steps),
    })),
  ];
}

/** The site content document the operators' common steps are kept in. */
export const ROUTE_COMMON_ID = 'route-common';

/**
 * What "Start from common steps" opens with until the operators save their
 * own: the nine steps sellers actually describe.
 */
export function builtInCommonSteps(): RouteStep[] {
  return SUGGESTED_STEPS.map((step, index) => ({
    id: `sg_${index}`,
    name: step.name,
    description: step.description,
    position: index,
    side: step.side,
    trigger: step.trigger,
    stageId: step.stageId,
    stageName: step.stageName,
    stageIcon: step.stageIcon,
    locked: step.locked,
    forward: step.forward,
    assignee: step.assignee,
  }));
}

export const isStageIcon = (value: unknown): value is StageIcon =>
  typeof value === 'string' && (STAGE_ICONS as readonly string[]).includes(value);
