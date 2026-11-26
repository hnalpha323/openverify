/**
 * C124.3: what `services/settings.ts` asks before it writes: a Fetch bad port, and a CIDR entry that
 * is no private or CGNAT block. A refusal names the setting and the category, and never echoes what
 * it was given.
 */
import { describe, expect, it } from 'vitest';
import { FETCH_BAD_PORTS, workflowEgressSettingsProblem } from './settings-check.js';

describe('the ports (C124.3)', () => {
  it.each([0, 25, 110, 143, 465, 587, 993, 6000, 6697, 10080])(
    'refuses the bad port %i',
    (port) => {
      const problem = workflowEgressSettingsProblem({ 'workflow-http-ports': [8443, port] });

      expect(problem).toMatchObject({ setting: 'workflow-http-ports' });
      expect(problem?.detail).toContain('bad port');
    },
  );

  it.each([444, 5432, 6379, 8443])('takes %i, which the Fetch list leaves open', (port) => {
    expect(workflowEgressSettingsProblem({ 'workflow-http-ports': [port] })).toBeNull();
  });

  it('holds the Fetch list as the note read it', () => {
    expect(FETCH_BAD_PORTS.size).toBe(83);
    expect([...FETCH_BAD_PORTS].slice(0, 6)).toEqual([0, 1, 7, 9, 11, 13]);
    expect(FETCH_BAD_PORTS.has(10080)).toBe(true);
    expect(FETCH_BAD_PORTS.has(443)).toBe(false);
  });
});

describe('the private CIDRs (C124.3)', () => {
  it.each([
    '10.0.0.0/8',
    '10.1.0.0/16',
    '172.16.0.0/12',
    '192.168.1.0/24',
    '100.64.0.0/11',
    '100.65.0.1/32',
    'fc00::/16',
    'fd12:3456::/32',
  ])('takes %s', (cidr) => {
    expect(workflowEgressSettingsProblem({ 'workflow-http-private-cidrs': [cidr] })).toBeNull();
  });

  it.each([
    ['0.0.0.0/0', 'metadata'],
    ['0.0.0.0/8', 'unspecified'],
    ['127.0.0.0/8', 'loopback'],
    ['169.254.0.0/16', 'metadata'],
    ['169.254.169.254/32', 'metadata'],
    ['168.63.129.16/32', 'metadata'],
    ['192.0.0.192/32', 'metadata'],
    // The whole of CGNAT holds Alibaba's metadata address.
    ['100.64.0.0/10', 'metadata'],
    ['100.100.100.200/32', 'metadata'],
    ['224.0.0.0/4', 'multicast'],
    ['255.255.255.255/32', 'broadcast'],
    ['240.0.0.0/4', 'broadcast'],
    ['240.0.0.0/5', 'reserved'],
    ['192.0.2.0/24', 'documentation'],
    ['198.18.0.0/15', 'benchmarking'],
    ['8.8.8.0/24', 'public'],
    // A bigger block than the private one it starts in.
    ['172.16.0.0/11', 'public'],
    ['::/0', 'unspecified'],
    ['::1/128', 'loopback'],
    ['fe80::/10', 'link_local'],
    ['ff00::/8', 'multicast'],
    ['2001:db8::/32', 'documentation'],
    ['2a00::/16', 'public'],
    // The whole of unique-local space holds the AWS and GCP metadata addresses.
    ['fc00::/7', 'metadata'],
    ['fd00::/8', 'metadata'],
    ['fd00:ec2::/32', 'metadata'],
  ])('refuses %s, naming %s', (cidr, category) => {
    const problem = workflowEgressSettingsProblem({ 'workflow-http-private-cidrs': [cidr] });

    expect(problem).toMatchObject({ setting: 'workflow-http-private-cidrs' });
    expect(problem?.detail).toContain(category);
    expect(problem?.detail).not.toContain(cidr);
  });

  it('reads a mapped entry as its embedded IPv4', () => {
    expect(
      workflowEgressSettingsProblem({ 'workflow-http-private-cidrs': ['::ffff:a00:0/104'] }),
    ).toBeNull();
    expect(
      workflowEgressSettingsProblem({ 'workflow-http-private-cidrs': ['::ffff:7f00:0/104'] }),
    ).toMatchObject({ setting: 'workflow-http-private-cidrs' });
  });
});

describe('everything else', () => {
  it('answers null for a change that names neither', () => {
    expect(workflowEgressSettingsProblem({ 'workflow-http-ports': [] })).toBeNull();
    expect(workflowEgressSettingsProblem({ 'workflow-link-hosts': ['a.example'] })).toBeNull();
  });
});
