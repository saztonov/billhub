/**
 * DTO тендерного портала. Портал строится в отдельном проекте по этому контракту (Bearer,
 * идемпотентное создание по externalRef, асинхронные результаты через опрос). snake_case —
 * как отдаёт/принимает внешний портал.
 */

export interface TenderItemInput {
  material: string;
  quantity: number;
  unit?: string | null;
  spec?: string | null;
}

export interface TenderConditionsInput {
  delivery?: string | null;
  payment?: string | null;
  deadline?: string | null; // ISO
}

export interface CreateTenderInput {
  title: string;
  /** Идемпотентность создания: externalRef = 'billhub:tender:<sourcingRoundId>'. */
  external_ref: string;
  deadline_at?: string | null;
  items: TenderItemInput[];
  conditions?: TenderConditionsInput;
}

export type TenderStatus = 'draft' | 'published' | 'awaiting_results' | 'finished' | 'cancelled';

export interface Tender {
  id: string;
  external_ref?: string | null;
  status: TenderStatus;
  url?: string | null;
}

export interface TenderParticipant {
  id: string;
  name: string;
  inn?: string | null;
}

export interface TenderBid {
  participant_id: string;
  amount: number;
  currency?: string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
  submitted_at?: string | null;
}

export interface TenderResults {
  tender_id: string;
  status: TenderStatus;
  participants: TenderParticipant[];
  bids: TenderBid[];
  winner?: { participant_id: string; bid_index?: number } | null;
  finished_at?: string | null;
}
