'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { onboardingSchema, CONSENT_VERSION, type OnboardingInput } from '@club/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, result } from '@/lib/api/client';
import { Button, ErrorNotice, Field } from './ui';
export function OnboardingForm() {
  const router = useRouter();
  const client = useQueryClient();
  const [consent, setConsent] = useState(false);
  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { birthDate: '', consentVersion: CONSENT_VERSION },
  });
  const mutation = useMutation({
    mutationFn: (body: OnboardingInput) => result(api.POST('/api/v1/me/onboarding', { body })),
    onSuccess: (me) => {
      client.setQueryData(['me'], me);
      router.replace('/cabinet');
    },
  });
  return (
    <form
      className="form"
      onSubmit={form.handleSubmit((value) => {
        if (consent) mutation.mutate(value);
      })}
    >
      <h1>Знакомство с Клубом</h1>
      <Field
        label="Дата рождения"
        hint="Клуб принимает совершеннолетних."
        error={form.formState.errors.birthDate?.message}
      >
        <input type="date" required {...form.register('birthDate')} />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          Согласен на обработку персональных данных по{' '}
          <Link href="/policy" target="_blank">
            политике Клуба
          </Link>{' '}
          (версия {CONSENT_VERSION}).
        </span>
      </label>
      <ErrorNotice error={mutation.error} />
      <Button disabled={mutation.isPending || !consent}>Продолжить</Button>
    </form>
  );
}
