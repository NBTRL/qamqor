import { TripEditor } from '@/components/curator';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripEditor id={id} />;
}
