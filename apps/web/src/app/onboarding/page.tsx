import { OnboardingForm } from '@/components/onboarding';
import { Protected } from '@/components/providers';
export const metadata = { title: 'Знакомство с Клубом', robots: { index: false, follow: false } };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="login">
      <Protected area="onboarding">
        <OnboardingForm next={typeof next === 'string' ? next : null} />
      </Protected>
    </div>
  );
}
