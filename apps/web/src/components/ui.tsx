'use client';
import Link from 'next/link';
import Image from 'next/image';
import {
  useEffect,
  useRef,
  useId,
  Children,
  isValidElement,
  cloneElement,
  Fragment,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react';
import { message, ApiError } from '@/lib/api/client';
export function Button({
  children,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <button {...props} className={`button button--${variant} ${props.className ?? ''}`}>
      {children}
    </button>
  );
}
export function ButtonLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link className={`button button--${secondary ? 'secondary' : 'primary'}`} href={href}>
      {children}
    </Link>
  );
}
export function Section({
  title,
  children,
  id,
  alt = false,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
  alt?: boolean;
}) {
  return (
    <section id={id} className={`section ${alt ? 'section--alt' : ''}`}>
      <div className="container">
        {title && <h2 className="section__title">{title}</h2>}
        {children}
      </div>
    </section>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__inner">
        <div className="modal__heading">
          <h2 id={titleId}>{title}</h2>
          <Button variant="secondary" onClick={onClose} aria-label="Закрыть окно">
            ×
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="notice notice--error" role="alert">
      {message(error)}
      {error instanceof ApiError && typeof error.details?.['reason'] === 'string' && (
        <>
          <br />
          {error.details['reason']}
        </>
      )}
    </p>
  ) : null;
}
export function Empty({ children = 'Здесь пока ничего нет.' }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Loading() {
  return (
    <div className="skeleton" role="status">
      Загрузка…
    </div>
  );
}
export function RichText({ html }: { html: string }) {
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const title = `${id}-label`;
  const help = `${id}-help`;
  const issue = `${id}-error`;
  const associate = (nodes: ReactNode): { nodes: ReactNode; linked: boolean } => {
    const mapped = Children.toArray(nodes).map((node) => {
      if (!isValidElement(node)) return { node, linked: false };
      const element = node as ReactElement<Record<string, unknown>>;
      if (node.type === Fragment) {
        const nested = associate(element.props['children'] as ReactNode);
        return { node: cloneElement(element, {}, nested.nodes), linked: nested.linked };
      }
      if (typeof node.type === 'string' && ['input', 'textarea', 'select'].includes(node.type))
        return {
          node: cloneElement(element, {
            id,
            'aria-invalid': !!error,
            'aria-describedby':
              [hint ? help : '', error ? issue : ''].filter(Boolean).join(' ') || undefined,
          }),
          linked: true,
        };
      return { node, linked: false };
    });
    return { nodes: mapped.map((row) => row.node), linked: mapped.some((row) => row.linked) };
  };
  const { nodes: controls, linked } = associate(children);
  return (
    <div className="field">
      {linked ? (
        <label htmlFor={id}>
          <span>{label}</span>
        </label>
      ) : (
        <span id={title}>{label}</span>
      )}
      {linked ? (
        controls
      ) : (
        <div role="group" aria-labelledby={title}>
          {controls}
        </div>
      )}
      {hint && <small id={help}>{hint}</small>}
      {error && (
        <span id={issue} role="alert" className="field__error">
          {error}
        </span>
      )}
    </div>
  );
}

export function HelpCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: string;
}) {
  return (
    <Link href={href} className="help-card">
      <span className="help-card__icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      <span className="help-card__link">Подробнее →</span>
    </Link>
  );
}

export function Icon({ name }: { name: string }) {
  return (
    <Image
      unoptimized
      src={`/icons/${name}.svg`}
      width={28}
      height={28}
      alt=""
      aria-hidden="true"
    />
  );
}
