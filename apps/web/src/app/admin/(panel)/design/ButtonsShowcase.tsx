import { Button, buttonClassName, type ButtonSize, type ButtonVariant } from '@repo/ui/button';
import { Mono } from '@repo/ui/typography';

const VARIANTS: ButtonVariant[] = ['primary', 'dark', 'secondary', 'ghost', 'danger', 'link'];
const SIZES: Exclude<ButtonSize, 'icon'>[] = ['sm', 'md', 'lg', 'xl'];

/** Every button variant and size, with the disabled, loading, pill, icon and link-as-button forms. */
export function ButtonsShowcase() {
  return (
    <div className="flex flex-col gap-6">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <Mono size="body-sm">variant=&quot;{variant}&quot;</Mono>
          <div className="flex flex-wrap items-center gap-3">
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {variant === 'link' ? 'View gallery' : `Button ${size}`}
              </Button>
            ))}
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-2">
        <Mono size="body-sm">loading · pill · arrow · icon · a link styled as a button</Mono>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading>Publishing</Button>
          <Button variant="dark" pill>
            New gallery
          </Button>
          <Button variant="secondary" arrow>
            Next
          </Button>
          <Button variant="secondary" size="icon" aria-label="More actions">
            ⋯
          </Button>
          <a href="#buttons" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            A link
          </a>
        </div>
      </div>
    </div>
  );
}
