import { Protected } from '@/components/providers';
import { WorkspaceNav } from '@/components/shell';
export const metadata = { title: 'Админка', robots: { index: false, follow: false } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container workspace">
      <Protected area="admin">
        <WorkspaceNav />
        {children}
      </Protected>
    </div>
  );
}
