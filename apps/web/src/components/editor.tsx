'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Upload } from './upload';
import type { UploadStateHandler } from './upload-guard';
import { imagePreviewNodeView } from './editor-image-preview';
const PreviewImage = Image.extend({
  addNodeView() {
    return imagePreviewNodeView;
  },
});
export default function Editor({
  value,
  onChange,
  onUploadStateChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onUploadStateChange?: UploadStateHandler;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [StarterKit, PreviewImage],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Текст материала', 'aria-multiline': 'true' },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  return (
    <div className="editor">
      <div className="editor__toolbar" aria-label="Форматирование текста">
        <button
          type="button"
          aria-label="Полужирный"
          aria-pressed={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          Ж
        </button>
        <button
          type="button"
          aria-label="Курсив"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          К
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          Заголовок
        </button>
        <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          Список
        </button>
        <button type="button" onClick={() => editor?.chain().focus().undo().run()}>
          Отменить
        </button>
      </div>
      <EditorContent editor={editor} />
      <Upload
        purpose="CONTENT"
        onStateChange={onUploadStateChange}
        disabled={disabled}
        onUploaded={(upload) =>
          editor?.chain().focus().setImage({ src: upload.fileUrl, alt: 'Иллюстрация' }).run()
        }
      />
    </div>
  );
}
