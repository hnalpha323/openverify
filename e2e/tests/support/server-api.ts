/**
 * A small client for the C2 server API, as a customer backend uses it: a bearer API key and
 * JSON:API bodies. Every response is parsed with the `@openverify/contracts` schema for it, so
 * a contract mismatch between the API and its clients fails the e2e run.
 */
import {
  createdWebhookDocumentSchema,
  inquiryDocumentSchema,
  inquiryTemplateDocumentSchema,
  resumeInquiryDocumentSchema,
  webhookDocumentSchema,
  type CreateInquiryTemplateAttributes,
  type EnabledEvents,
  type InquiryDocument,
} from '@openverify/contracts';
import type { z } from 'zod';

export class ServerApiError extends Error {
  override name = 'ServerApiError';
}

export interface ServerApi {
  createWebhook(
    url: string,
    events: EnabledEvents,
  ): Promise<z.infer<typeof createdWebhookDocumentSchema>['data']>;
  disableWebhook(id: string): Promise<void>;
  createInquiryTemplate(
    attributes: CreateInquiryTemplateAttributes,
  ): Promise<z.infer<typeof inquiryTemplateDocumentSchema>['data']>;
  createInquiry(templateId: string, referenceId: string): Promise<InquiryDocument['data']>;
  /** The session token and the hosted-flow URL that carries it in its fragment. */
  resumeInquiry(id: string): Promise<{ sessionToken: string; flowUrl: string }>;
  getInquiry(id: string): Promise<InquiryDocument>;
}

export function createServerApi(baseUrl: string, apiKey: string): ServerApi {
  async function send<S extends z.ZodType>(
    schema: S,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ServerApiError(`${method} ${path} answered ${String(response.status)}: ${text}`);
    }
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new ServerApiError(
        `${method} ${path} does not match its contract: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  return {
    async createWebhook(url, events) {
      const document = await send(createdWebhookDocumentSchema, 'POST', '/api/v1/webhooks', {
        data: { type: 'webhook', attributes: { url, 'enabled-events': events } },
      });
      return document.data;
    },
    async disableWebhook(id) {
      await send(webhookDocumentSchema, 'PATCH', `/api/v1/webhooks/${id}`, {
        data: { type: 'webhook', attributes: { status: 'disabled' } },
      });
    },
    async createInquiryTemplate(attributes) {
      const document = await send(
        inquiryTemplateDocumentSchema,
        'POST',
        '/api/v1/inquiry-templates',
        { data: { type: 'inquiry-template', attributes } },
      );
      return document.data;
    },
    async createInquiry(templateId, referenceId) {
      const document = await send(inquiryDocumentSchema, 'POST', '/api/v1/inquiries', {
        data: {
          type: 'inquiry',
          attributes: { 'inquiry-template-id': templateId, 'reference-id': referenceId },
        },
      });
      return document.data;
    },
    async resumeInquiry(id) {
      const document = await send(
        resumeInquiryDocumentSchema,
        'POST',
        `/api/v1/inquiries/${id}/resume`,
      );
      return {
        sessionToken: document.meta['session-token'],
        flowUrl: document.meta['flow-url'],
      };
    },
    getInquiry: (id) =>
      send(inquiryDocumentSchema, 'GET', `/api/v1/inquiries/${id}?include=verifications`),
  };
}
