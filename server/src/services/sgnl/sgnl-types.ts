/**
 * DTO публичного API SIGNAL (OpenAPI: https://api.sgnl.pro/openapi/v1/schema.yml).
 * Описаны только поля, которые использует выгрузка счетов.
 */

/** Проект компании (GET /public/v1/projects) */
export interface SgnlProject {
  id: string;
  name: string;
  code: string;
}

/** Узел дерева папок проекта (GET /public/v1/projects/{id}/folders/tree) */
export interface SgnlFolderNode {
  id: string;
  name: string;
  /** Regular | System */
  type?: string;
  children: SgnlFolderNode[];
}

/** Элемент папки (GET /public/v1/items) */
export interface SgnlItem {
  id: string;
  name: string;
  /** File | Link | FileGroup | Xml */
  type: string;
  deleted: boolean;
  topVersionId?: string | null;
}

/** Тикет загрузки объекта (PUT /public/v1/objects) */
export interface SgnlUploadTicket {
  objectId: string;
  signedUrl: string;
  ttlSec: number;
}

/** Ответ вида { data: <uuid> } */
export interface SgnlGuidDto {
  data: string;
}

/** Ответ получения токена (POST /public/v1/auth/token) */
export interface SgnlAuthToken {
  token: string;
  /** Срок действия в секундах */
  expiresIn: number;
}
