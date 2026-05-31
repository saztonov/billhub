/**
 * zod-схема типа таблицы метаданных файлов (используется роутами files/file-proxy и FileRepository).
 */
import { z } from 'zod';

export const fileEntityTypeValues = [
  'payment_request_files',
  'approval_decision_files',
  'contract_request_files',
  'payment_payment_files',
  'founding_document_files',
] as const;

export const fileEntityTypeSchema = z.enum(fileEntityTypeValues);
export type FileEntityType = (typeof fileEntityTypeValues)[number];
