import { PlaceNeeds } from '@/components/curator';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlaceNeeds id={id} />;
}
