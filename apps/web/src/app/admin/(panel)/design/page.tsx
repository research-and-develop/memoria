import type { Metadata } from 'next';

import { PageHeader } from '@/components/admin/PageHeader';

import { ButtonsShowcase } from './ButtonsShowcase';
import { ColorSwatches } from './ColorSwatches';
import { ControlsDemo } from './ControlsDemo';
import { DesignSection } from './DesignSection';
import { FieldsDemo } from './FieldsDemo';
import { GalleryThemes } from './GalleryThemes';
import { GalleryTypography } from './GalleryTypography';
import { PickersDemo } from './PickersDemo';
import { ShapesShowcase } from './ShapesShowcase';
import { TabsChipsDemo } from './TabsChipsDemo';
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
      <DesignSection id="pickers" title="Radio cards and swatch picker" note="Keyboard: Tab into the group; the arrow keys move and select.">
        <PickersDemo />
      </DesignSection>
      <DesignSection
        id="tabs"
        title="Tabs, chips and the scrim"
        note="Keyboard: Tab to the selected tab; the arrow keys move (the set chips select on Enter). Chips grow to 44 px on a touch screen. The scrim is only for badges and buttons on a photo."
      >
        <TabsChipsDemo />
      </DesignSection>
      <DesignSection id="shapes" title="Pills, cards, radii, focus">
        <ShapesShowcase />
      </DesignSection>
      <DesignSection
        id="gallery-themes"
        title="Gallery themes"
        note="The client gallery's light, dark and auto themes with every accent (packages/ui/theme/gallery.mjs). An accent too faint for a theme is adjusted automatically."
      >
        <GalleryThemes />
      </DesignSection>
      <DesignSection
        id="gallery-type"
        title="Gallery typography"
        note="The font pairings a gallery can use (packages/ui/theme/galleryFonts.mjs), with a Latin and a Cyrillic title."
      >
        <GalleryTypography />
      </DesignSection>
    </div>
  );
}
