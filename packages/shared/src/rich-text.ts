// CMS HTML is sanitized by the API. Empty editor paragraphs should use the same
// fallback as an empty string, while a material containing only an image is valid.
export function hasRichTextContent(html: string): boolean {
  const content = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const images = content.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/gi);
  for (const image of images) if ((image[1] ?? image[2] ?? image[3] ?? '').trim()) return true;
  return Boolean(
    content
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:nbsp|#0*160|#x0*a0|#0*32|#x0*20|Tab|NewLine);/gi, ' ')
      .replace(/[\s\u200b-\u200d\ufeff]/g, ''),
  );
}
