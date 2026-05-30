/**
 * Общие типы для Repository-слоя.
 * Используются всеми доменными интерфейсами.
 */

/** Параметры пагинации для list-методов */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** Стандартный результат list-метода с серверной пагинацией */
export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
}

/** Стандартный фильтр поиска по тексту */
export interface SearchFilter {
  search?: string;
}

/**
 * Ошибка, выкидываемая при попытке найти запись по id и она не найдена.
 * Роуты конвертируют её в 404.
 */
export class NotFoundError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} с id=${id} не найдена`);
    this.name = 'NotFoundError';
  }
}

/**
 * Ошибка нарушения уникальности (например, попытка создать пользователя с уже существующим email).
 * Роуты конвертируют её в 409 Conflict.
 */
export class UniqueConstraintError extends Error {
  constructor(
    public readonly entity: string,
    public readonly field: string,
    public readonly value: string,
  ) {
    super(`${entity}.${field}="${value}" уже существует`);
    this.name = 'UniqueConstraintError';
  }
}

/**
 * Ошибка нарушения foreign-key (например, удалить контрагента, на которого ссылается заявка).
 * Роуты конвертируют её в 409 Conflict.
 */
export class ForeignKeyConstraintError extends Error {
  constructor(
    public readonly entity: string,
    public readonly relatedEntity: string,
  ) {
    super(`Невозможно удалить ${entity}: есть связанные ${relatedEntity}`);
    this.name = 'ForeignKeyConstraintError';
  }
}
