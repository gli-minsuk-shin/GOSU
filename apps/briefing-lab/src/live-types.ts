import type { MailAccountContext } from './mail-account';
import type { PaperBibliography } from './paper-bibliography';
import type { DuplicateMail } from './mail-duplicates';
import type { MailTargetCoverage } from '../briefing-mail-ingestion';
export type LiveKind = 'weather' | 'papers' | 'email';
export type WeatherSeries = {
  city: string;
  timeZone: string;
  localDate: string;
  currentTime: string;
  temperature: number | null;
  code: number | null;
  wind: number | null;
  hours: {
    time: number;
    temperature: number | null;
    apparent: number | null;
    precipitation: number | null;
    code: number | null;
  }[];
};
export type LiveItem = {
  mailContentProof?: DuplicateMail['mailContentProof'];
  mailCopies?: DuplicateMail['mailCopies'];
  mailDuplicateCheckedAt?: string;
  id: string;
  kind: LiveKind;
  title: string;
  text: string;
  source: string;
  sourceUrl?: string;
  mailMessageUrl?: string;
  mailNativeId?: string;
  mailAccount?: MailAccountContext;
  mailUnread?: boolean;
  mailMarkedReadAt?: string;
  /** Web links from the raw HTML source, for Scholar alert papers; not saved with summaries. */
  mailLinks?: { text: string; href: string }[];
  publishedAt?: string;
  bibliography?: PaperBibliography;
  readScope: 'forecast' | 'abstract' | 'paper-metadata' | 'mail-metadata' | 'mail-preview';
  details: string[];
  score?: number;
  matchedKeywords?: string[];
  weather?: WeatherSeries;
  privateOrigin?: 'mail';
  discoverySource?: 'google-scholar-alert';
  paper?: {
    readScope: 'html-excerpt' | 'pdf-text-excerpt' | 'abstract';
    excerpt: string;
    equations: { id: string; latex: string }[];
    figures: { id: string; caption: string; assetUrl: string; imageData?: string }[];
    sourceUrl: string;
    note: string;
  };
};
export type LiveSourceResult = {
  /** Mail runs only: what each mailbox read examined, committed after summaries are saved. */
  mailCoverage?: MailTargetCoverage[];
  notice?: string;
  historyWarning?: string;
  /** A source-level problem the user should see even though items were read. */
  warning?: string;
  receiptId?: string;
  kind: LiveKind;
  status: 'ready' | 'empty' | 'failed';
  fetchedAt: string;
  items: LiveItem[];
  note: string;
  error?: string;
};
export type LiveProgress = {
  kind: LiveKind;
  state: 'started' | 'completed';
  count?: number;
  detail?: string;
};
export type MailAccount = { id: string; name: string; addresses?: string[] };
export type Mailbox = { id: string; name: string };
export type MailDiscovery = {
  accounts: (MailAccount & { mailboxes: Mailbox[]; limited: boolean; unavailable: boolean })[];
  limited: boolean;
};
export type MailConnectionStatus = {
  state: 'connected' | 'configured' | 'disconnected' | 'expired' | 'scope-changed';
  expiresAt: string | null;
  accountName?: string;
  mailboxName?: string;
  mailRead?: boolean;
  mailAi?: boolean;
  approved?: boolean;
};
