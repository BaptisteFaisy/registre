/**
 * SES v2 notifier — the production `Notifier` (chapter 11.2: "Reminders | SES |
 * e-mails to the owners").
 *
 * The SDK is imported lazily, behind `EmailTransport`: importing this module
 * never loads `@aws-sdk/client-sesv2`, and a test can inject a transport that
 * records instead of sending. Any failure surfaces as `upstream(...)`, which the
 * reminder job turns into an alarm (ENF-OBS-01).
 */

import type { Clock, NotificationMessage, Notifier } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { configError, upstream } from '../support/errors.ts';

/** Environment variables read by `sesOptionsFromEnv`. */
export const SES_FROM_ENV = 'REGISTRE_SES_FROM';
export const SES_CONFIG_SET_ENV = 'REGISTRE_SES_CONFIGURATION_SET';

/** One e-mail, in the shape the transport expects. */
export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  configurationSetName?: string;
}

/** The single call the notifier needs; tests inject a recorder. */
export interface EmailTransport {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export interface SesNotifierOptions {
  /** Verified sender identity (`noreply@msp.example`). */
  from: string;
  region?: string;
  clock?: Clock;
  /** SES configuration set: bounce and complaint feedback (ENF-OBS-01). */
  configurationSetName?: string;
  /** Injected transport; omitted in production where the SDK is used. */
  transport?: EmailTransport;
  id?: string;
}

/** Reads the sender identity and region from the environment. */
export function sesOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { from: string; region: string; configurationSetName?: string } {
  const from = env[SES_FROM_ENV];
  if (from === undefined || from.trim().length === 0) {
    throw configError(`ses: ${SES_FROM_ENV} must be set to a verified sender identity`);
  }
  const configurationSetName = env[SES_CONFIG_SET_ENV];
  return {
    from,
    region: env.REGISTRE_REGION ?? env.AWS_REGION ?? 'eu-west-3',
    ...(configurationSetName === undefined ? {} : { configurationSetName })
  };
}

export class SesNotifier implements Notifier {
  readonly id: string;

  private readonly options: SesNotifierOptions;
  private readonly clock: Clock;
  private messages: NotificationMessage[] = [];
  private cached: EmailTransport | null = null;

  /** Builds the notifier; the transport is injected in tests only. */
  constructor(options: SesNotifierOptions) {
    if (options.from.trim().length === 0) throw configError('ses: a sender identity is required');
    this.options = options;
    this.clock = options.clock ?? new SystemClock();
    this.id = options.id ?? 'ses-notifier';
  }

  /** Sends one notification; a transport failure becomes `upstream(...)`. */
  async send(message: NotificationMessage): Promise<{ id: string; sentAt: string }> {
    try {
      const result = await this.transport().send({
        from: this.options.from,
        to: message.to,
        subject: message.subject,
        body: message.body,
        ...(this.options.configurationSetName === undefined
          ? {}
          : { configurationSetName: this.options.configurationSetName })
      });
      this.messages.push(structuredClone(message));
      return { id: result.messageId, sentAt: this.clock.now() };
    } catch (error) {
      throw upstream('ses: sending the notification failed', {
        to: message.to,
        kind: message.kind,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /** Every notification accepted by SES since the start of the process. */
  sent(): NotificationMessage[] {
    return this.messages.map((message) => structuredClone(message));
  }

  private transport(): EmailTransport {
    if (this.options.transport !== undefined) return this.options.transport;
    this.cached ??= sesTransportFromSdk(this.options.region ?? 'eu-west-3');
    return this.cached;
  }
}

/**
 * Real transport. The SDK is imported on first send only, so an offline run
 * never loads it.
 */
export function sesTransportFromSdk(region: string): EmailTransport {
  return {
    async send(email) {
      const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
      const client = new SESv2Client({ region });
      const response = await client.send(
        new SendEmailCommand({
          FromEmailAddress: email.from,
          Destination: { ToAddresses: [email.to] },
          ...(email.configurationSetName === undefined
            ? {}
            : { ConfigurationSetName: email.configurationSetName }),
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: 'UTF-8' },
              Body: { Text: { Data: email.body, Charset: 'UTF-8' } }
            }
          }
        })
      );
      return { messageId: response.MessageId ?? 'unknown' };
    }
  };
}
