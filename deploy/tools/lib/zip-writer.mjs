/**
 * zip-writer — запись ZIP-архива средствами встроенного zlib, без внешних зависимостей.
 *
 * Зачем: разовые выгрузки (deploy/tools/export-*.mjs) запускаются в уже собранном образе
 * billhub-api, где нет ни archiver, ни jszip, а ставить зависимость ради разовой операции —
 * это пересборка и деплой образа. Утилиты zip в образе (node:20-bookworm-slim) тоже нет.
 *
 * Поддерживается классический ZIP (не Zip64): до 65535 записей и 4 ГБ на архив/файл —
 * при превышении бросается понятная ошибка. Имена пишутся в UTF-8 с флагом EFS (bit 11),
 * иначе кириллица в путях ломается в проводнике Windows.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { once } from 'node:events';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** Версия ZIP 2.0 — достаточно для store/deflate без Zip64. */
const VERSION = 20;
/** Bit 11 — имена и комментарии в UTF-8. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** Лимиты классического ZIP. */
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
/** Файлы крупнее читаются потоком в два прохода (CRC + запись), а не целиком в память. */
const STREAM_THRESHOLD = 32 * 1024 * 1024;

/* ---------------------------------- CRC32 --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/** Накопительный CRC32: crc32(chunk, предыдущий результат). */
export function crc32(buffer, previous = 0) {
  let crc = ~previous;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

/* --------------------------------- Заголовки ------------------------------- */

/** Дата/время в формате MS-DOS (2-секундная точность, начало эпохи — 1980 год). */
export function toDosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

/**
 * Нормализует путь записи: posix-разделители, без ведущего слэша и без сегментов «..».
 * Служит вторым рубежом после sanitizeFsName — архив не должен распаковываться мимо каталога.
 */
export function normalizeEntryName(name) {
  const parts = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  if (parts.length === 0) throw new Error(`Некорректное имя записи в архиве: ${name}`);
  return parts.join('/');
}

function buildLocalHeader(entry, nameBuffer) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(SIG_LOCAL, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer]);
}

function buildCentralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(SIG_CENTRAL, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.nameBuffer]);
}

function buildEocd(entriesCount, centralSize, centralOffset) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entriesCount, 8);
  eocd.writeUInt16LE(entriesCount, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

/* -------------------------------- ZipWriter -------------------------------- */

export class ZipWriter {
  /** @param {string} outputPath путь архива @param {Date} date отметка времени записей */
  constructor(outputPath, date = new Date()) {
    this.outputPath = outputPath;
    this.stream = createWriteStream(outputPath);
    // Ошибку потока (нет места, права) запоминаем и бросаем на ближайшей записи —
    // иначе она всплыла бы как необработанное событие и прогон завершился бы молча
    this.streamError = null;
    this.stream.on('error', (error) => {
      this.streamError = error;
    });
    this.entries = [];
    this.offset = 0;
    const dos = toDosDateTime(date);
    this.dosTime = dos.time;
    this.dosDate = dos.date;
    this.closed = false;
  }

  /** Запись с учётом backpressure — иначе большой архив съест память. */
  async #write(chunk) {
    if (this.streamError) throw this.streamError;
    if (this.offset + chunk.length > MAX_UINT32) {
      throw new Error('Архив превысил бы 4 ГБ — классический ZIP такого не выдержит, нужна выгрузка частями');
    }
    if (!this.stream.write(chunk)) await once(this.stream, 'drain');
    this.offset += chunk.length;
  }

  #prepareEntry(name) {
    if (this.closed) throw new Error('Архив уже закрыт');
    if (this.entries.length >= MAX_ENTRIES) {
      throw new Error(`В классическом ZIP не более ${MAX_ENTRIES} записей — нужна выгрузка частями`);
    }
    const entryName = normalizeEntryName(name);
    return { entryName, nameBuffer: Buffer.from(entryName, 'utf8') };
  }

  async #pushEntry({ entryName, nameBuffer, method, crc, compressedSize, size }) {
    const entry = {
      entryName,
      nameBuffer,
      method,
      crc,
      compressedSize,
      size,
      dosTime: this.dosTime,
      dosDate: this.dosDate,
      offset: this.offset,
    };
    await this.#write(buildLocalHeader(entry, nameBuffer));
    this.entries.push(entry);
    return entry;
  }

  /** Добавляет содержимое из памяти (реестры CSV). По умолчанию сжимается — текст жмётся хорошо. */
  async addBuffer(name, content, { compress = true } = {}) {
    const { entryName, nameBuffer } = this.#prepareEntry(name);
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const payload = compress ? deflateRawSync(raw) : raw;

    await this.#pushEntry({
      entryName,
      nameBuffer,
      method: compress ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(raw),
      compressedSize: payload.length,
      size: raw.length,
    });
    await this.#write(payload);
  }

  /**
   * Добавляет файл с диска без сжатия: выгрузка — это PDF и сканы, они уже сжаты,
   * deflate дал бы проценты за счёт заметного времени.
   */
  async addFile(name, sourcePath) {
    const { entryName, nameBuffer } = this.#prepareEntry(name);
    const info = await stat(sourcePath);
    if (info.size > MAX_UINT32) {
      throw new Error(`Файл больше 4 ГБ не помещается в классический ZIP: ${sourcePath}`);
    }

    // Мелкие файлы читаем целиком, крупные — двумя проходами (CRC, затем запись),
    // чтобы не держать в памяти сотни мегабайт
    if (info.size <= STREAM_THRESHOLD) {
      const raw = await readFile(sourcePath);
      await this.#pushEntry({
        entryName,
        nameBuffer,
        method: METHOD_STORE,
        crc: crc32(raw),
        compressedSize: raw.length,
        size: raw.length,
      });
      await this.#write(raw);
      return;
    }

    let crc = 0;
    for await (const chunk of createReadStream(sourcePath)) crc = crc32(chunk, crc);
    await this.#pushEntry({
      entryName,
      nameBuffer,
      method: METHOD_STORE,
      crc,
      compressedSize: info.size,
      size: info.size,
    });
    let written = 0;
    for await (const chunk of createReadStream(sourcePath)) {
      await this.#write(chunk);
      written += chunk.length;
    }
    if (written !== info.size) {
      throw new Error(`Размер файла изменился во время упаковки: ${sourcePath}`);
    }
  }

  /** Дописывает центральный каталог и EOCD, закрывает поток. */
  async close() {
    if (this.closed) return { entries: this.entries.length, bytes: this.offset };
    const centralOffset = this.offset;
    for (const entry of this.entries) await this.#write(buildCentralHeader(entry));
    const centralSize = this.offset - centralOffset;
    await this.#write(buildEocd(this.entries.length, centralSize, centralOffset));

    this.closed = true;
    const total = this.offset;
    await new Promise((resolve, reject) => {
      this.stream.once('error', reject);
      this.stream.end(resolve);
    });
    return { entries: this.entries.length, bytes: total };
  }
}
