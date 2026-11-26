import { describe, expect, it } from 'vitest';
import * as entry from '@openverify/ui';
import { Alert } from './alert';
import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { cx } from './cx';
import { Field, Input } from './field';

describe('@openverify/ui entry point', () => {
  it('exports the primitives, resolving the package name to its TypeScript source', () => {
    // String keys only: Vitest's module namespace also carries an enumerable Symbol.toStringTag.
    expect(Object.keys(entry).sort()).toEqual([
      'Alert',
      'Button',
      'Card',
      'Checkbox',
      'Field',
      'Input',
      'cx',
    ]);
    expect(entry).toMatchObject({ Alert, Button, Card, Checkbox, Field, Input, cx });
  });
});
