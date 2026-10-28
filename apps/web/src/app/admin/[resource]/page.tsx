import { notFound } from 'next/navigation';
import { resources } from '@/lib/resources';
import {
  AdminResource,
  Applications,
  StatOverrides,
  AdminNotifications,
  AuditLog,
} from '@/components/admin';
export default async function Page({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (resource === 'applications') return <Applications />;
  if (resource === 'stat-overrides') return <StatOverrides />;
  if (resource === 'notifications') return <AdminNotifications />;
  if (resource === 'audit-log') return <AuditLog />;
  if (!(resource in resources)) notFound();
  return <AdminResource resourceKey={resource as keyof typeof resources} />;
}
