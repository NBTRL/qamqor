'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  emailSchema,
  emailCodeSchema,
  ErrorCode,
  LoginTokenStatus,
  loginTokenStatusLabels,
} from '@club/shared';
import { api, ApiError, result, setAccessToken, type Model } from '@/lib/api/client';
import { onboardingPath, safeReturn } from '@/lib/format';
import { Button, ErrorNotice, Field } from './ui';
const codeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Введите шестизначный код.'),
});
export function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const [attempt, setAttempt] = useState<Model<'TelegramStartResponseDto'> | null>(null);
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<Model<'SessionResponseDto'>['status'] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [admin, setAdmin] = useState(false);
  const [backup, setBackup] = useState(false);
  const done = useRef(false);
  const finish = async (session: Model<'SessionResponseDto'>) => {
    if (session.nextStep === 'ADMIN_EMAIL_CODE') {
      setAdmin(true);
      setAttempt(null);
      return;
    }
    if (!session.accessToken) return;
    setAccessToken(session.accessToken);
    setAttempt(null);
    try {
      const me = await result(api.GET('/api/v1/me'));
      client.setQueryData(['me'], me);
      router.replace(
        me.onboardingCompleted
          ? safeReturn(params.get('next'))
          : onboardingPath(params.get('next')),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === ErrorCode.ONBOARDING_REQUIRED)
        router.replace(onboardingPath(params.get('next')));
      else setError(cause);
    }
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  const start = useMutation({
    mutationFn: () => result(api.POST('/api/v1/auth/telegram/start', { body: {} })),
    onSuccess: (data) => {
      done.current = false;
      setError(null);
      setQr('');
      setStatus(LoginTokenStatus.PENDING);
      setAttempt(data);
      setBackup(false);
    },
    onError: setError,
  });
  useEffect(() => {
    if (!attempt) return;
    let alive = true;
    void QRCode.toDataURL(attempt.deepLink, { width: 220, margin: 2, errorCorrectionLevel: 'M' })
      .then((value) => {
        if (alive) setQr(value);
      })
      .catch(setError);
    return () => {
      alive = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    let busy = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const expiry = setTimeout(
      () => {
        if (active && !done.current) {
          done.current = true;
          controller.abort();
          setStatus(LoginTokenStatus.EXPIRED);
        }
      },
      Math.max(0, Date.parse(attempt.expiresAt) - Date.now()),
    );
    const poll = async () => {
      if (!active || done.current || busy) return;
      const now = Date.now();
      if (now >= Date.parse(attempt.expiresAt)) {
        done.current = true;
        setStatus(LoginTokenStatus.EXPIRED);
        return;
      }
      if (now - last < 1000) {
        clearTimeout(timer);
        timer = setTimeout(() => void poll(), 1000 - (now - last));
        return;
      }
      busy = true;
      last = now;
      try {
        const data = await result(
          api.GET('/api/v1/auth/telegram/status', {
            params: {
              query: { token: attempt.token },
              header: { 'X-Poll-Secret': attempt.pollSecret },
            },
            signal: controller.signal,
          }),
        );
        if (!active) return;
        setStatus(data.status);
        if (data.accessToken || data.nextStep) {
          done.current = true;
          await finishRef.current(data);
        } else if (
          data.status === LoginTokenStatus.DECLINED ||
          data.status === LoginTokenStatus.EXPIRED
        )
          done.current = true;
      } catch (cause) {
        if (!active || done.current) return;
        done.current = true;
        if (cause instanceof ApiError && cause.details?.status === LoginTokenStatus.DECLINED)
          setStatus(LoginTokenStatus.DECLINED);
        else if (cause instanceof ApiError && cause.code === ErrorCode.LOGIN_TOKEN_EXPIRED)
          setStatus(LoginTokenStatus.EXPIRED);
        else setError(cause);
      } finally {
        busy = false;
        if (active && !done.current) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    const focus = () => {
      clearTimeout(timer);
      void poll();
    };
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(expiry);
      controller.abort();
      window.removeEventListener('focus', focus);
    };
  }, [attempt]);
  const code = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema) });
  const verify = useMutation({
    mutationFn: (body: z.infer<typeof codeSchema>) =>
      result(api.POST('/api/v1/auth/admin/verify-code', { body })),
    onSuccess: (session) => finish(session),
  });
  const configured =
    error instanceof ApiError &&
    (error.code === 'TELEGRAM_NOT_CONFIGURED' || error.code === ErrorCode.TELEGRAM_UNAVAILABLE);
  const noAdminEmail = error instanceof ApiError && error.code === ErrorCode.ADMIN_EMAIL_REQUIRED;
  return (
    <div className="login">
      <p className="eyebrow">Рады видеть вас</p>
      <h1>Вход в Клуб</h1>
      <p>Один вход через Telegram для новых участников и волонтеров.</p>
      {admin ? (
        <form className="form" onSubmit={code.handleSubmit((value) => verify.mutate(value))}>
          <h2>Введите код из письма</h2>
          <Field label="Одноразовый код" error={code.formState.errors.code?.message}>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              {...code.register('code')}
            />
          </Field>
          {process.env.NODE_ENV === 'development' && (
            <p>
              Тестовые письма доступны в{' '}
              <a href="http://localhost:8025" target="_blank" rel="noreferrer">
                Mailpit
              </a>
              .
            </p>
          )}
          <ErrorNotice error={verify.error} />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setAdmin(false);
              setError(null);
            }}
          >
            Начать вход заново
          </Button>
          <Button disabled={verify.isPending}>Подтвердить вход</Button>
        </form>
      ) : (
        <>
          {!attempt && (
            <Button disabled={start.isPending} onClick={() => start.mutate()}>
              Войти через Telegram
            </Button>
          )}
          <ol className="login__steps">
            <li>Нажмите «Старт» в боте.</li>
            <li>Нажмите «Поделиться номером».</li>
            <li>Нажмите «Да, это я».</li>
            <li>Вернитесь на сайт.</li>
          </ol>
          <p className="text-muted">
            Номер нужен только для подтверждения аккаунта. Подтверждайте только вход, который начали
            сами.
          </p>
          {attempt && (
            <>
              <div className="login__qr">
                {qr && (
                  <Image
                    unoptimized
                    src={qr}
                    width="220"
                    height="220"
                    alt="QR-код ссылки для открытия Telegram-бота"
                  />
                )}
                <a className="button" href={attempt.deepLink} target="_blank" rel="noreferrer">
                  Открыть в Telegram
                </a>
              </div>
              <p className="login__status" role="status" aria-live="polite">
                {status === LoginTokenStatus.CONTACT_RECEIVED
                  ? 'Подтвердите вход в боте'
                  : status
                    ? loginTokenStatusLabels[status]
                    : ''}
              </p>
              {(status === LoginTokenStatus.DECLINED ||
                status === LoginTokenStatus.EXPIRED ||
                !!error) && (
                <Button disabled={start.isPending} onClick={() => start.mutate()}>
                  {status === LoginTokenStatus.EXPIRED ? 'Повторить' : 'Попробовать снова'}
                </Button>
              )}
            </>
          )}
          {configured ? (
            <p className="notice" role="alert">
              Бот не настроен: добавьте токен в .env.
            </p>
          ) : noAdminEmail ? (
            <p className="notice" role="alert">
              Обратитесь к главному администратору.
            </p>
          ) : (
            <ErrorNotice error={error} />
          )}
          {!noAdminEmail && (
            <div className="actions">
              <Button
                variant="secondary"
                onClick={() => {
                  done.current = true;
                  setAttempt(null);
                  setBackup(!backup);
                }}
              >
                Нет доступа к Telegram?
              </Button>
            </div>
          )}
          {backup && <BackupLogin onSuccess={(session) => void finishRef.current(session)} />}
        </>
      )}
    </div>
  );
}
function BackupLogin({ onSuccess }: { onSuccess: (session: Model<'SessionResponseDto'>) => void }) {
  const [sent, setSent] = useState(false);
  const schema = sent ? emailCodeSchema : emailCodeSchema.extend({ code: z.string().optional() });
  const form = useForm<{ email: string; code?: string }>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', code: '' },
  });
  const mutation = useMutation({
    mutationFn: async (value: { email: string; code?: string }) => {
      const email = emailSchema.parse(value.email);
      if (!sent) {
        await result(api.POST('/api/v1/auth/email/login-code', { body: { email } }));
        setSent(true);
      } else
        onSuccess(
          await result(
            api.POST('/api/v1/auth/email/verify', { body: emailCodeSchema.parse(value) }),
          ),
        );
    },
  });
  return (
    <form className="form" onSubmit={form.handleSubmit((value) => mutation.mutate(value))}>
      <h2>Резервный вход</h2>
      <p>
        Доступен, если e-mail был подтвержден в профиле. Для администраторов этот способ отключен.
      </p>
      <Field label="E-mail" error={form.formState.errors.email?.message}>
        <input type="email" autoComplete="email" {...form.register('email')} readOnly={sent} />
      </Field>
      {sent && (
        <>
          <p role="status">Если резервный вход доступен, код отправлен. Проверьте почту.</p>
          <Field label="Код из письма" error={form.formState.errors.code?.message}>
            <input inputMode="numeric" autoComplete="one-time-code" {...form.register('code')} />
          </Field>
        </>
      )}
      <ErrorNotice error={mutation.error} />
      <Button disabled={mutation.isPending}>{sent ? 'Войти по коду' : 'Получить код'}</Button>
    </form>
  );
}
