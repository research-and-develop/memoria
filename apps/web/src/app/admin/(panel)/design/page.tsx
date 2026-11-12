import type { Metadata } from 'next';

import { PageHeader } from '@/components/admin/PageHeader';

import { ButtonsShowcase } from './ButtonsShowcase';
import { ColorSwatches } from './ColorSwatches';
import { ControlsDemo } from './ControlsDemo';
import { DesignSection } from './DesignSection';
import { FieldsDemo } from './FieldsDemo';
import { ShapesShowcase } from './ShapesShowcase';
import { TypeScale } from './TypeScale';

export const metadata: Metadata = { title: 'Design', robots: { index: false, follow: false } };

/**
 * The design system on one page: every theme token and every @repo/ui primitive. It reads the theme
 * (packages/ui/theme/studio.mjs) wherever it can, so a new token shows up without an edit here.
 * Check it at 360 px and 1440 px after any change to the theme or a primitive.
 */
export default function DesignPage() {
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Design system" description="Every value comes from packages/ui/theme/studio.mjs: edit it there and this page follows." />
      <DesignSection id="colors" title="Colour roles" note="Swatches paint the CSS variables the app uses; the ratio is the role as text on surface.">
        <ColorSwatches />
      </DesignSection>
      <DesignSection id="type" title="Typography">
        <TypeScale />
      </DesignSection>
      <DesignSection id="buttons" title="Buttons" note="On a touch screen, sm, md and icon buttons get a 44 px hit area.">
        <ButtonsShowcase />
      </DesignSection>
      <DesignSection id="fields" title="Form fields">
        <FieldsDemo />
      </DesignSection>
      <DesignSection id="controls" title="Toggle and segmented control" note="Keyboard: Tab to a control; Space toggles; the arrow keys move and select.">
        <ControlsDemo />
      </DesignSection>
      <DesignSection id="shapes" title="Pills, cards, radii, focus">
        <ShapesShowcase />
      </DesignSection>
    </div>
  );
}
