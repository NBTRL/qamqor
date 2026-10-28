import type { NodeViewRenderer } from '@tiptap/react';
import { api, result } from '@/lib/api/client';

function localFileId(source: string): string | undefined {
  try {
    const url = new URL(source, document.baseURI);
    if (url.origin !== window.location.origin) return undefined;
    return /^\/api\/v1\/files\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.exec(
      url.pathname,
    )?.[1];
  } catch {
    return undefined;
  }
}

// Only the node-view DOM uses a signed URL. TipTap serializes the original node attributes.
export const imagePreviewNodeView: NodeViewRenderer = ({ node }) => {
  const image = document.createElement('img');
  let source: string | undefined;
  let request: AbortController | undefined;
  let destroyed = false;

  const update = (attributes: Record<string, unknown>) => {
    for (const key of ['alt', 'title', 'width', 'height']) {
      const value = attributes[key];
      if (value === null || value === undefined) image.removeAttribute(key);
      else image.setAttribute(key, String(value));
    }
    const nextSource = typeof attributes.src === 'string' ? attributes.src : '';
    if (source === nextSource) return;
    source = nextSource;
    request?.abort();
    image.removeAttribute('src');
    if (!source) return;
    const id = localFileId(source);
    if (!id) {
      image.setAttribute('src', source);
      return;
    }
    const controller = new AbortController();
    request = controller;
    const originalSource = source;
    void result(
      api.GET('/api/v1/uploads/{id}/preview', {
        params: { path: { id } },
        signal: controller.signal,
      }),
    )
      .then(({ url }) => {
        if (!destroyed && !controller.signal.aborted) image.setAttribute('src', url);
      })
      .catch(() => {
        if (!destroyed && !controller.signal.aborted) image.setAttribute('src', originalSource);
      });
  };

  update(node.attrs);
  return {
    dom: image,
    update(nextNode) {
      if (nextNode.type !== node.type) return false;
      update(nextNode.attrs);
      return true;
    },
    // ProseMirror must not read the temporary DOM src back into the saved document.
    ignoreMutation: (mutation) => mutation.type !== 'selection',
    destroy() {
      destroyed = true;
      request?.abort();
    },
  };
};
