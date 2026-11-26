'use client';
/**
 * `<OpenVerifyFlow>` (plan C266.2): one container element with `@openverify/js`'s embed mounted in
 * it through `useOpenVerify`. Its props are the embed's options plus the container's id, class and
 * style; the frame inside it is the embed's own.
 */
import type { CSSProperties, ReactElement } from 'react';
import { useOpenVerify, type OpenVerifyOptions } from './use-open-verify.js';

export interface OpenVerifyFlowProps extends OpenVerifyOptions {
  /** The container's id, class and style; the frame inside it is the embed's own. */
  readonly id?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function OpenVerifyFlow(props: OpenVerifyFlowProps): ReactElement {
  const { id, className, style, ...options } = props;
  const { ref } = useOpenVerify(options);
  return <div ref={ref} id={id} className={className} style={style} />;
}
