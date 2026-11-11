/**
 * Public surface of the notify module (EF-REL-01/02/03, chapter 11.2).
 */

export { SES_CONFIG_SET_ENV, SES_FROM_ENV, SesNotifier, sesOptionsFromEnv, sesTransportFromSdk } from './ses.ts';
export type { EmailTransport, OutgoingEmail, SesNotifierOptions } from './ses.ts';

export {
  evidenceToProvide,
  reasonSentence,
  reminderBody,
  reminderMessage,
  reminderSubject
} from './reminderText.ts';
export type { ReminderTextInput } from './reminderText.ts';

export {
  changeLines,
  digestBody,
  digestSubject,
  gapLines,
  readinessLines,
  validationLines,
  weeklyDigest
} from './digest.ts';
export type { WeeklyDigestInput } from './digest.ts';
