import Image from 'next/image';
import { PlaceNeeds } from '@/components/place-needs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { placeTypeLabels, PlaceType } from '@club/shared';
import { publicDetail, sections } from '@/lib/public-content';
import { RichText } from '@/components/ui';
import { PrivatePlace } from '@/components/public-widgets';
import { date } from '@/lib/format';
const mediaSchema = z.object({
  id: z.string(),
  type: z.enum(['PHOTO', 'VIDEO']),
  url: z.string(),
  caption: z.string().nullish(),
});
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string; slug: string }>;
}) {
  const { section, slug } = await params;
  try {
    const item = await publicDetail(section, slug);
    const title = item && ('title' in item ? item.title : 'name' in item ? item.name : 'Материал');
    return {
      title,
      description: `${title}. ${sections[section as keyof typeof sections] ?? 'Материалы Клуба'}.`,
      openGraph: { title, url: `/${section}/${slug}` },
    };
  } catch {
    return { title: 'Материал не найден' };
  }
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string; slug: string }>;
}) {
  const { section, slug } = await params;
  let item;
  try {
    item = await publicDetail(section, slug);
  } catch {
    notFound();
  }
  if (!item) notFound();
  return (
    <article className="container section">
      <Link href={`/${section}`}>← {sections[section as keyof typeof sections]}</Link>
      <h1>{'title' in item ? item.title : item.name}</h1>
      {'bodyHtml' in item ? (
        <>
          {'publishedAt' in item && <p>{date(item.publishedAt, false)}</p>}
          <RichText html={item.bodyHtml} />
        </>
      ) : 'type' in item ? (
        <>
          <span className="badge">{placeTypeLabels[item.type]}</span>
          <p>
            {item.region.name} · {item.city}
          </p>
          {item.type === PlaceType.YARD_PROGRAM && item.district && <p>Район: {item.district}</p>}
          <p>{item.description}</p>
          {item.address && <p>Адрес: {item.address}</p>}
          {item.privateNotes && <p>{item.privateNotes}</p>}
          <PrivatePlace slug={slug} />
          <PlaceNeeds
            placeId={item.id}
            initial={
              item.needs && item.needsTotal !== undefined
                ? {
                    items: item.needs,
                    total: item.needsTotal,
                    page: 1,
                    limit: 20,
                  }
                : undefined
            }
          />
        </>
      ) : (
        <>
          <p>{item.description}</p>
          <div className="grid">
            {item.items?.map((value) => {
              const parsed = mediaSchema.safeParse(value);
              if (!parsed.success) return null;
              const media = parsed.data;
              return (
                <figure key={media.id}>
                  {media.type === 'VIDEO' ? (
                    <video
                      controls
                      src={media.url}
                      preload="metadata"
                      aria-label={media.caption ?? 'Видео'}
                    />
                  ) : (
                    <Image
                      unoptimized
                      src={media.url}
                      width="640"
                      height="400"
                      loading="lazy"
                      alt={media.caption ?? 'Фотография Клуба'}
                    />
                  )}
                  <figcaption>{media.caption}</figcaption>
                </figure>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}
