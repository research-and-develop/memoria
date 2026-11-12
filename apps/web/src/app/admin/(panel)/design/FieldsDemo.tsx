'use client';

import { Button } from '@repo/ui/button';
import { Checkbox, FormField, Input, Select, Textarea } from '@repo/ui/input';
import { Text } from '@repo/ui/typography';

/** Form fields: default with a hint, an error, disabled, a select, a textarea, checkboxes. */
export function FieldsDemo() {
  return (
    <form className="grid gap-5 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} noValidate>
      <FormField label="Gallery title" hint="Shown to the client.">
        {(ids) => <Input {...ids} placeholder="Maria & Jonas" />}
      </FormField>
      <FormField label="Client email" error="Enter a valid email address.">
        {(ids) => <Input {...ids} type="email" defaultValue="maria@" />}
      </FormField>
      <FormField label="Slug">{(ids) => <Input {...ids} defaultValue="maria-jonas" disabled />}</FormField>
      <FormField label="Download size">
        {(ids) => (
          <Select {...ids} defaultValue="web">
            <option value="web">Web size (2048 px)</option>
            <option value="original">Original</option>
          </Select>
        )}
      </FormField>
      <FormField label="Message to the client" className="sm:col-span-2">
        {(ids) => <Textarea {...ids} placeholder="Here are your photos…" />}
      </FormField>
      <div className="flex flex-col sm:col-span-2">
        <Checkbox label="Allow downloads" defaultChecked />
        <Checkbox label="Require an email before downloading" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit">Save</Button>
        <Text size="body-sm" tone="muted">
          On phones the field text is 16 px, so iOS does not zoom in.
        </Text>
      </div>
    </form>
  );
}
