/**
 * Границы владения файлами РП в billhub S3. Файлы, загруженные в РП, лежат в папке
 * rp-letters/<id>/; вложения авто-РП ссылаются на исходные файлы заявки, договора и
 * учредительных документов — при удалении РП их удалять нельзя.
 */

/** Ключи S3, принадлежащие самой РП (папка rp-letters/<id>/); прочие — исходные файлы. */
export function ownRpFileKeys(rpLetterId: string, fileKeys: string[]): string[] {
  const prefix = `rp-letters/${rpLetterId}/`;
  return fileKeys.filter((k) => k.startsWith(prefix));
}
