'use client';

import { useState } from 'react';

import { Chip } from '@repo/ui/chip';
import { TabPanel, Tabs, type TabItem } from '@repo/ui/tabs';
import { Caption, Mono, Text } from '@repo/ui/typography';

const SECTIONS: TabItem<string>[] = [
  { value: 'photos', label: 'Photos', count: 846 },
  { value: 'selections', label: 'Selections', count: 3 },
  { value: 'downloads', label: 'Downloads' },
  { value: 'activity', label: 'Activity' },
  { value: 'settings', label: 'Settings' },
  { value: 'later', label: 'Disabled', disabled: true },
];
const SETS: TabItem<string>[] = [
  { value: 'highlights', label: 'Highlights', count: 48 },
  { value: 'getting-ready', label: 'Getting ready', count: 120 },
  { value: 'ceremony', label: 'Ceremony', count: 210 },
  { value: 'portraits', label: 'Portraits', count: 160 },
  { value: 'reception', label: 'Reception', count: 302 },
];
const FILTERS = ['Hidden', 'Favourites', 'Commented'] as const;

/** Tabs (line and chip), toggle chips, and the scrim's badges and buttons on a light and a dark photo. */
export function TabsChipsDemo() {
  const [section, setSection] = useState('photos');
  const [set, setSet] = useState('ceremony');
  const [filters, setFilters] = useState<string[]>(['Favourites']);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Tabs id="design-sections" aria-label="Gallery sections" items={SECTIONS} value={section} onValueChange={setSection} />
        {SECTIONS.map((item) => (
          <TabPanel key={item.value} id="design-sections" value={item.value} selected={item.value === section}>
            <Caption>
              The <Mono size="caption">{item.value}</Mono> panel (Tabs, variant line).
            </Caption>
          </TabPanel>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Text size="body-sm" weight="semibold">
          Set chips (Tabs, variant chip): they scroll sideways on a phone
        </Text>
        <Tabs id="design-sets" aria-label="Sets" variant="chip" activation="manual" items={SETS} value={set} onValueChange={setSet} />
      </div>

      <div className="flex flex-col gap-2">
        <Text size="body-sm" weight="semibold">
          Toggle chips
        </Text>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((name) => (
            <Chip key={name} selected={filters.includes(name)} onClick={() => setFilters((on) => (on.includes(name) ? on.filter((n) => n !== name) : [...on, name]))}>
              {name}
            </Chip>
          ))}
          <Chip selected={false} disabled>
            Disabled
          </Chip>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Text size="body-sm" weight="semibold">
          The scrim on a photo: badges at 80 %, buttons at 55 %
        </Text>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['bg-wash', 'bg-ink-2'] as const).map((photo) => (
            <div key={photo} className={`relative h-32 rounded-card ${photo}`}>
              <span className="absolute right-2 top-2 rounded-full bg-scrim/80 px-2 py-0.5 text-micro font-semibold text-inverse">Cover</span>
              <span className="absolute left-2 top-2 rounded-full bg-scrim/80 px-2 py-0.5 text-micro font-semibold tabular-nums text-inverse">12</span>
              <span aria-hidden className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-scrim/55 text-inverse">
                ↓
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
