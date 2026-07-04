/**
 * Типы внешнего API PayHub (/api/external/v1).
 *
 * ВНИМАНИЕ: это ВНЕШНИЕ DTO — поля в snake_case, как их возвращает PayHub.
 * Клиент отдаёт их без преобразования; при отдаче через HTTP-роуты BillHub
 * ключи автоматически конвертируются глобальным preSerialization-хуком (camelCase).
 * PayHub может возвращать дополнительные поля — известные перечислены явно,
 * остальные доступны через индексную сигнатуру.
 */

/** Направление письма */
export type PayHubLetterDirection = 'incoming' | 'outgoing';

/* ------------------------------------------------------------------ */
/*  Справочники (scope catalog:read)                                   */
/* ------------------------------------------------------------------ */

/** Проект PayHub (аналог объекта строительства BillHub) */
export interface PayHubProject {
  id: number;
  /** Код проекта — участвует в генерации reg_number писем */
  code?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

/** Контрагент PayHub */
export interface PayHubContractor {
  id: number | string;
  name?: string | null;
  inn?: string | null;
  [key: string]: unknown;
}

/** Статус письма PayHub */
export interface PayHubLetterStatus {
  id: number | string;
  name?: string | null;
  code?: string | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Письма                                                             */
/* ------------------------------------------------------------------ */

/** Тип участника письма (отправитель/получатель) */
export type PayHubParticipantType = 'individual' | 'contractor';

/** Письмо PayHub */
export interface PayHubLetter {
  id: string;
  project_id: number;
  direction: PayHubLetterDirection;
  /** Дата письма, YYYY-MM-DD */
  letter_date: string;
  /** Собственный номер письма */
  number?: string | null;
  /** Регистрационный номер — генерируется сервером PayHub */
  reg_number?: string | null;
  subject?: string | null;
  /** Внешний ключ идемпотентности (например billhub:rp:<uuid>) */
  external_ref?: string | null;
  created_by?: string | null;
  [key: string]: unknown;
}

/** Публичная ссылка на письмо + QR */
export interface PayHubShare {
  share_url: string;
  token?: string;
  /** Брендированный QR как SVG-строка */
  qr_svg?: string;
  /** Тот же QR как data:image/svg+xml;base64,... для вставки в <img> */
  qr_svg_data_url?: string;
  [key: string]: unknown;
}

/**
 * Тело создания письма.
 * reg_number намеренно запрещён на уровне типов (never): его генерирует
 * сервер PayHub в формате <КОД_ПРОЕКТА>-<ВХ|ИСХ>-<YYMM>-<NNNN>.
 */
export interface CreatePayHubLetterInput {
  project_id: number;
  direction: PayHubLetterDirection;
  /** Дата письма, YYYY-MM-DD */
  letter_date: string;
  /** Собственный номер письма (рекомендуется) */
  number?: string;
  subject?: string;
  /** Содержание письма */
  content?: string;
  /** Ответственный — свободный текст (ФИО) */
  responsible_person_name?: string;
  /** Отправитель: тип + контрагент PayHub (id из catalog/contractors) */
  sender_type?: PayHubParticipantType;
  sender_contractor_id?: number;
  /** Получатель: тип + контрагент PayHub */
  recipient_type?: PayHubParticipantType;
  recipient_contractor_id?: number;
  /** Внешний ключ идемпотентности (billhub:rp:<uuid>); требует поддержки на PayHub */
  external_ref?: string;
  /** true — в ответе будет share (ссылка + QR) */
  ensure_share?: boolean;
  /** Запрещено: генерирует сервер PayHub */
  reg_number?: never;
  [key: string]: unknown;
}

/** Тело редактирования письма (PATCH, только свои письма) */
export interface UpdatePayHubLetterInput {
  number?: string;
  subject?: string;
  letter_date?: string;
  /** Запрещено: генерирует сервер PayHub */
  reg_number?: never;
  [key: string]: unknown;
}

/** Результат создания письма */
export interface PayHubLetterCreated {
  letter: PayHubLetter;
  /** Присутствует при ensure_share: true */
  share?: PayHubShare;
}

/** Параметры поиска писем (только по номеру/рег.номеру) */
export interface ListPayHubLettersParams {
  number?: string;
  reg_number?: string;
  offset?: number;
  limit?: number;
}

/** Результат поиска писем */
export interface PayHubLetterList {
  letters: PayHubLetter[];
  total?: number;
}

/** Параметры lookup по реквизитам (404 — не найдено, 409 — неоднозначно) */
export interface LookupPayHubLetterParams {
  reg_number?: string;
  number?: string;
  /** Точный поиск по внешнему ключу идемпотентности (приоритетнее остальных) */
  external_ref?: string;
  /** Уточнение при 409 ambiguous_letter_lookup */
  project_id?: number;
}

/** Результат lookup: письмо + ссылка */
export interface PayHubLetterLookupResult {
  letter: PayHubLetter;
  share?: PayHubShare;
}

/* ------------------------------------------------------------------ */
/*  Вложения                                                           */
/* ------------------------------------------------------------------ */

/** Вложение письма */
export interface PayHubAttachment {
  id: string;
  original_name?: string | null;
  size_bytes?: number | null;
  mime_type?: string | null;
  /** Описание; BillHub кладёт сюда метку billhub:att:<uuid> для дедупа при повторе */
  description?: string | null;
  [key: string]: unknown;
}

/** Запрос presign для загрузки вложения */
export interface PresignAttachmentUploadInput {
  file_name: string;
  content_type?: string;
  size_bytes?: number;
}

/** Ответ presign: PUT байтов идёт напрямую в S3 (мимо BFF PayHub) */
export interface PayHubPresignResult {
  url: string;
  headers: Record<string, string>;
  storage_path: string;
}

/** Привязка загруженного файла к письму */
export interface RegisterAttachmentInput {
  original_name: string;
  storage_path: string;
  size_bytes: number;
  mime_type?: string;
  /** Описание вложения (метка для дедупа при повторе) */
  description?: string;
}

/** Файл для высокоуровневой загрузки одним вызовом */
export interface UploadAttachmentFileInput {
  name: string;
  bytes: Buffer | Uint8Array;
  mime_type?: string;
  /** Описание вложения (метка для дедупа при повторе) */
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Служебное                                                          */
/* ------------------------------------------------------------------ */

/** Результат проверки доступности PayHub */
export interface PayHubPingResult {
  ok: true;
  latencyMs: number;
}
