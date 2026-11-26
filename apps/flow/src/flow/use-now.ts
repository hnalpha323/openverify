import { useEffect, useState } from 'react';
import { useFlowEnvironment } from './flow-environment';

/**
 * The wall clock (`currentTime`), read again every `countdownIntervalMs` while the component is
 * mounted, so a countdown or an expiry follows it. Only the components that call it re-render.
 */
export function useNow(): number {
  const { currentTime, countdownIntervalMs } = useFlowEnvironment();
  const [now, setNow] = useState(currentTime);

  useEffect(() => {
    setNow(currentTime());
    const timer = setInterval(() => {
      setNow(currentTime());
    }, countdownIntervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [currentTime, countdownIntervalMs]);

  return now;
}

/** `seconds` as `m:ss`, the countdown's wording in both languages. */
export function formatWait(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}
