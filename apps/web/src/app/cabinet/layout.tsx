import { Protected } from '@/components/providers';
import { WorkspaceNav } from '@/components/shell';
export const metadata = { title: 'Кабинет', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container workspace">
      <Protected>
        <WorkspaceNav />
        {children}
      </Protected>
    </div>
  );
}
