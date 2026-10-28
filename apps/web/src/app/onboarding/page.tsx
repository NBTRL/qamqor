import { OnboardingForm } from '@/components/onboarding';
import { Protected } from '@/components/providers';
export const metadata = { title: 'Знакомство с Клубом', robots: { index: false, follow: false } };
export default function Page() {
  return (
    <div className="login">
      <Protected area="onboarding">
        <OnboardingForm />
      </Protected>
    </div>
  );
}
