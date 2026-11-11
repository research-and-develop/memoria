'use client';

import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@repo/ui/button';
import { useApi } from '@repo/ui/hooks/useApi';
import { Checkbox, FormField, Input, Textarea } from '@repo/ui/input';

import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { parseContactInput, type ContactField } from '@/lib/contact/parseContactInput';

type Errors = Partial<Record<ContactField | 'form', string>>;

/**
 * The contact form: validated here with the SAME pure parser the API uses, then
 * POSTed through `useApi` with a Turnstile token. A hidden honeypot field
 * (`website`) catches naive bots. The server is the real check.
 */
export function ContactForm() {
  const [values, setValues] = useState({ name: '', email: '', message: '', consent: false, website: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const { execute, loading } = useApi<{ id: string | null }>('/api/contact', { method: 'POST' });

  const set = (field: keyof typeof values) => (value: string | boolean) => setValues((v) => ({ ...v, [field]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseContactInput(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    if (!token) {
      setErrors({ form: 'Wait for the security check, then try again.' });
      return;
    }
    setErrors({});
    const result = await execute({ ...values, turnstileToken: token });
    if (result.error) {
      if (result.error.errorCode === 'ABORT_ERROR') return;
      const details = result.error.details ?? {};
      const message = typeof details.message === 'string' ? details.message : 'Sending failed. Please try again.';
      const field = typeof details.field === 'string' ? (details.field as ContactField) : null;
      setErrors(field ? { [field]: message } : { form: message });
      turnstileRef.current?.reset(); // a token is single-use
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <p role="status" className="rounded-xl bg-success-wash px-4 py-3 font-semibold text-success">
        Thank you — your message has been sent.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div aria-live="polite">
        {errors.form ? (
          <p role="alert" className="rounded-xl bg-danger-wash px-4 py-3 text-body-sm font-semibold text-danger">
            {errors.form}
          </p>
        ) : null}
      </div>
      <FormField label="Name" error={errors.name}>
        {(ids) => <Input {...ids} autoComplete="name" value={values.name} onChange={(e) => set('name')(e.target.value)} />}
      </FormField>
      <FormField label="Email" error={errors.email}>
        {(ids) => <Input {...ids} type="email" autoComplete="email" value={values.email} onChange={(e) => set('email')(e.target.value)} />}
      </FormField>
      <FormField label="Message" error={errors.message}>
        {(ids) => <Textarea {...ids} value={values.message} onChange={(e) => set('message')(e.target.value)} />}
      </FormField>
      {/* Honeypot: invisible to people, filled by naive bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="hidden"
        value={values.website}
        onChange={(e) => set('website')(e.target.value)}
      />
      <div className="flex flex-col gap-2">
        <Checkbox
          label="I agree that my message is stored so you can answer it."
          checked={values.consent}
          onChange={(e) => set('consent')(e.target.checked)}
          aria-invalid={errors.consent ? true : undefined}
        />
        {errors.consent ? <p className="text-caption font-semibold text-danger">{errors.consent}</p> : null}
      </div>
      <Turnstile ref={turnstileRef} action="contact" onToken={setToken} onError={() => setErrors({ form: 'The security check did not load. Reload the page.' })} />
      <Button type="submit" variant="primary" loading={loading} className="self-start">
        Send
      </Button>
    </form>
  );
}
