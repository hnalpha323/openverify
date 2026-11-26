// @vitest-environment node
import { OpenVerifyApiError, type ApiProblem } from '@openverify/node';
import { describe, expect, it, vi } from 'vitest';
import { problemDocument } from '../../testing/api-mock';
import { loadSection } from './section-data';

const apiError = (status: number, slug?: 'forbidden') =>
  new OpenVerifyApiError(problemDocument(status, slug) as unknown as ApiProblem, null);

describe('loadSection', () => {
  it('loads nothing without the permission', async () => {
    const load = vi.fn();

    await expect(loadSection(false, load)).resolves.toEqual({ kind: 'hidden' });
    expect(load).not.toHaveBeenCalled();
  });

  it('hands over the data', async () => {
    await expect(loadSection(true, () => Promise.resolve([1]))).resolves.toEqual({
      kind: 'ready',
      data: [1],
    });
  });

  it("turns the API's 403 into the section's forbidden state", async () => {
    await expect(
      loadSection(true, () => Promise.reject(apiError(403, 'forbidden'))),
    ).resolves.toEqual({ kind: 'forbidden' });
  });

  it('lets every other failure reach the page', async () => {
    const failure = apiError(500);

    await expect(loadSection(true, () => Promise.reject(failure))).rejects.toBe(failure);
  });
});
