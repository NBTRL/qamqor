import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { setAccessToken } from '@/lib/api/client';
import { imagePreviewNodeView } from './editor-image-preview';

const id = '723f0e74-fb92-4ada-b46b-3933685a5843';
const stableUrl = `${window.location.origin}/api/v1/files/${id}`;
const signedUrl = 'https://storage.example.test/image.png?signature=temporary';
let editors: Editor[] = [];

function createEditor(source: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Image.extend({
        addNodeView() {
          return imagePreviewNodeView;
        },
      }),
    ],
    content: `<p>Материал</p><img src="${source}" alt="Иллюстрация">`,
  });
  editors.push(editor);
  return editor;
}
const response = () =>
  new Response(JSON.stringify({ url: signedUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  setAccessToken('admin-access');
});
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  editors = [];
  setAccessToken();
});

describe('Private CMS images in the editor', () => {
  it.each([stableUrl, `/api/v1/files/${id}`])(
    'previews %s using the authenticated API and saves only its stable URL',
    async (source) => {
      const fetch = vi.fn(async (_request: Request) => response());
      vi.stubGlobal('fetch', fetch);
      const editor = createEditor(source);
      await vi.waitFor(() => {
        expect(editor.view.dom.querySelector('img')).toHaveAttribute('src', signedUrl);
      });
      expect(fetch).toHaveBeenCalledOnce();
      const request = fetch.mock.calls[0]![0] as Request;
      expect(new URL(request.url).pathname).toBe(`/api/v1/uploads/${id}/preview`);
      expect(request.headers.get('Authorization')).toBe('Bearer admin-access');
      expect(new URL(request.url).search).toBe('');
      expect(editor.getHTML()).toContain(`src="${source}"`);
      expect(editor.getHTML()).not.toContain('signature=');
      expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs?.src).toBe(
        source,
      );
    },
  );

  it('leaves external images unchanged', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const source = `https://other.example.test/api/v1/files/${id}`;
    const editor = createEditor(source);
    expect(editor.view.dom.querySelector('img')).toHaveAttribute('src', source);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts pending previews on destroy and ignores a late response', async () => {
    let resolve: (value: Response) => void = () => undefined;
    const fetch = vi.fn(
      (_request: Request) =>
        new Promise<Response>((complete) => {
          resolve = complete;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const editor = createEditor(stableUrl);
    const image = editor.view.dom.querySelector('img')!;
    const request = fetch.mock.calls[0]![0];
    editor.destroy();
    expect(request.signal.aborted).toBe(true);
    resolve(response());
    await vi.waitFor(() => expect(fetch).toHaveResolved());
    expect(image).not.toHaveAttribute('src');
  });
});
