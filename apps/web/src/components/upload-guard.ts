'use client';
import { useCallback, useRef, useState } from 'react';

export type UploadState = 'idle' | 'pending' | 'error';
export type UploadStateHandler = (id: string, state: UploadState) => void;

export function useUploadGuard() {
  const unresolved = useRef(new Set<string>());
  const [blocked, setBlocked] = useState(false);
  const onStateChange = useCallback<UploadStateHandler>((id, state) => {
    if (state === 'idle') unresolved.current.delete(id);
    else unresolved.current.add(id);
    setBlocked(unresolved.current.size > 0);
  }, []);
  // Read synchronously in submit handlers, including after async validation.
  const isBlocked = useCallback(() => unresolved.current.size > 0, []);
  return { blocked, isBlocked, onStateChange };
}
