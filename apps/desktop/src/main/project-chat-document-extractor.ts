import { inflateRawSync } from 'node:zlib';

export type ProjectChatDocumentFormat =
  'docx' | 'pptx' | 'ppt' | 'hwpx' | 'text' | 'markdown' | 'csv' | 'json' | 'latex';

export type ExtractedAttachmentUnit = Readonly<{
  unitNumber: number;
  text: string;
}>;

export type ExtractedProjectChatDocument = Readonly<{
  format: ProjectChatDocumentFormat;
  unitLabel: 'page' | 'slide' | 'section' | 'part';
  unitCount: number;
  units: readonly ExtractedAttachmentUnit[];
  extractedCharacters: number;
  truncated: boolean;
  textAvailable: boolean;
  reconstructionNotice: string;
}>;

export type ProjectChatDocumentExtractionErrorCode =
  | 'attachment_invalid'
  | 'attachment_too_large'
  | 'attachment_encrypted'
  | 'attachment_archive_limit'
  | 'attachment_extraction_failed';

export class ProjectChatDocumentExtractionError extends Error {
  constructor(readonly code: ProjectChatDocumentExtractionErrorCode) {
    super(code);
    this.name = 'ProjectChatDocumentExtractionError';
  }
}

const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_SELECTED_EXPANDED_BYTES = 12 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const MAX_DOCUMENT_UNITS = 500;
const MAX_PLAIN_TEXT_BYTES = 12 * 1024 * 1024;
const MAX_XML_DEPTH = 256;
const MAX_XML_TAGS = 200_000;
const MAX_CLEANUP_INPUT_CHARACTERS = 1_048_576;
const CLEANUP_INPUT_MULTIPLIER = 4;
const CLEANUP_INPUT_OVERREAD = 4_096;

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE_URI = 'http://www.w3.org/2000/xmlns/';
const OFFICE_RELATIONSHIP_NAMESPACES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
] as const;
const WORDPROCESSINGML_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
] as const;
const PRESENTATIONML_NAMESPACES = [
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
] as const;
const DRAWINGML_NAMESPACES = [
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
] as const;
const HWPX_MANIFEST_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0';
const HWPX_OPF_NAMESPACE = 'http://www.idpf.org/2007/opf/';
const HWPX_SECTION_NAMESPACE = 'http://www.hancom.co.kr/hwpml/2011/section';
const HWPX_PARAGRAPH_NAMESPACE = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
const DOCX_MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const PPTX_MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const DOCX_HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const DOCX_FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const DOCX_FOOTNOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const DOCX_ENDNOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
const PPTX_SLIDE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const PPTX_NOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return value >>> 0;
});
const CFB_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENCRYPTED_PACKAGE_UTF16 = new Uint8Array(Buffer.from('EncryptedPackage', 'utf16le'));
const ENCRYPTED_PACKAGE_ASCII = new Uint8Array(Buffer.from('EncryptedPackage', 'ascii'));
const LEGACY_ENCRYPTION_MARKERS = ['EncryptionInfo', 'EncryptedSummary', 'DataSpaces'].flatMap(
  (value) => [
    new Uint8Array(Buffer.from(value, 'utf16le')),
    new Uint8Array(Buffer.from(value, 'ascii')),
  ],
);

type ArchiveEntries = ReadonlyMap<string, Uint8Array>;
type SourceUnit = Readonly<{ text: string; truncated?: boolean }>;

type XmlAttributes = ReadonlyMap<string, string>;
type XmlStartElement = Readonly<{
  name: string;
  localName: string;
  namespaceUri: string;
  attributes: XmlAttributes;
  attributeNamespaceUris: ReadonlyMap<string, string>;
  depth: number;
  selfClosing: boolean;
}>;

type XmlVisitor = Readonly<{
  start?: (element: XmlStartElement) => void;
  end?: (element: Pick<XmlStartElement, 'name' | 'localName' | 'namespaceUri' | 'depth'>) => void;
  text?: (text: string, depth: number) => void;
}>;

type PackageRelationship = Readonly<{
  id: string;
  type: string;
  target: string;
  external: boolean;
}>;

type ContentTypes = Readonly<{
  overrides: ReadonlyMap<string, string>;
  defaults: ReadonlyMap<string, string>;
}>;

type ZipEntry = Readonly<{
  path: string;
  directory: boolean;
  compression: 0 | 8;
  compressedSize: number;
  originalSize: number;
  crc32: number;
  dataStart: number;
  dataEnd: number;
}>;

export async function extractProjectChatDocument(
  format: ProjectChatDocumentFormat,
  bytes: Uint8Array,
  maxCharacters: number,
): Promise<ExtractedProjectChatDocument> {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || !(bytes instanceof Uint8Array)) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }

  try {
    switch (format) {
      case 'docx':
        return await extractDocx(bytes, maxCharacters);
      case 'pptx':
        return await extractPptx(bytes, maxCharacters);
      case 'hwpx':
        return await extractHwpx(bytes, maxCharacters);
      case 'ppt':
        return extractLegacyPpt(bytes, maxCharacters);
      case 'text':
      case 'markdown':
      case 'csv':
      case 'json':
      case 'latex':
        return extractPlainText(format, bytes, maxCharacters);
    }
  } catch (error) {
    if (error instanceof ProjectChatDocumentExtractionError) throw error;
    throw new ProjectChatDocumentExtractionError('attachment_extraction_failed');
  }
}

async function extractDocx(bytes: Uint8Array, maxCharacters: number) {
  const archive = await readSelectedArchive('docx', bytes);
  assertOnlyRequestedOpenXmlFormat(archive, 'docx');
  const contentTypes = parseContentTypes(requiredXml(archive, '[Content_Types].xml'));
  const packageRelationships = parsePackageRelationships(requiredXml(archive, '_rels/.rels'));
  const mainPart = officeDocumentPart(packageRelationships, 'word');
  if (!mainPart || contentTypeForPart(contentTypes, mainPart) !== DOCX_MAIN_CONTENT_TYPE) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const documentXml = requiredXml(archive, mainPart);
  const references = collectDocxReferences(documentXml);
  const relationshipPath = relationshipsPartPath(mainPart);
  const relationships = archive.has(relationshipPath)
    ? parsePackageRelationships(requiredXml(archive, relationshipPath))
    : [];
  const relationshipById = indexRelationshipsById(relationships);
  const sourceUnits: SourceUnit[] = [
    labelledUnit('Document body', extractWordprocessingText(documentXml, 'document')),
  ];
  const seenParts = new Set<string>();

  for (const reference of references.headerFooter) {
    const relationship = relationshipById.get(reference.relationshipId);
    const expectedType = reference.kind === 'header' ? 'header' : 'footer';
    const expectedContentType =
      reference.kind === 'header' ? DOCX_HEADER_CONTENT_TYPE : DOCX_FOOTER_CONTENT_TYPE;
    if (!relationship || !relationshipTypeIs(relationship, expectedType)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const path = resolvePartRelationshipTarget(mainPart, relationship.target);
    if (
      relationship.external ||
      !/^word\/(?:header|footer)\d+\.xml$/u.test(path) ||
      !archive.has(path) ||
      contentTypeForPart(contentTypes, path) !== expectedContentType
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    if (seenParts.has(path)) continue;
    seenParts.add(path);
    sourceUnits.push(
      labelledUnit(
        docxPartLabel(path),
        extractWordprocessingText(
          requiredXml(archive, path),
          reference.kind === 'header' ? 'hdr' : 'ftr',
        ),
      ),
    );
  }

  for (const note of [
    {
      kind: 'footnotes',
      ids: references.footnoteIds,
      contentType: DOCX_FOOTNOTES_CONTENT_TYPE,
      label: 'Footnotes',
      elementName: 'footnote',
    },
    {
      kind: 'endnotes',
      ids: references.endnoteIds,
      contentType: DOCX_ENDNOTES_CONTENT_TYPE,
      label: 'Endnotes',
      elementName: 'endnote',
    },
  ] as const) {
    if (note.ids.size === 0) continue;
    const relationship = uniqueRelationshipByType(relationships, note.kind);
    if (!relationship || relationship.external) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const path = resolvePartRelationshipTarget(mainPart, relationship.target);
    if (
      !new RegExp(`^word/${note.kind}\\.xml$`, 'u').test(path) ||
      !archive.has(path) ||
      contentTypeForPart(contentTypes, path) !== note.contentType
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const text = extractReferencedWordNotes(requiredXml(archive, path), note.elementName, note.ids);
    sourceUnits.push(labelledUnit(note.label, text));
  }

  return finalizeExtraction(
    'docx',
    'part',
    sourceUnits,
    maxCharacters,
    'Reconstructed WordprocessingML text; page layout, embedded objects, and tracked formatting are not preserved.',
  );
}

async function extractPptx(bytes: Uint8Array, maxCharacters: number) {
  const archive = await readSelectedArchive('pptx', bytes);
  assertOnlyRequestedOpenXmlFormat(archive, 'pptx');
  const contentTypes = parseContentTypes(requiredXml(archive, '[Content_Types].xml'));
  const packageRelationships = parsePackageRelationships(requiredXml(archive, '_rels/.rels'));
  const mainPart = officeDocumentPart(packageRelationships, 'ppt');
  if (!mainPart || contentTypeForPart(contentTypes, mainPart) !== PPTX_MAIN_CONTENT_TYPE) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const presentationXml = requiredXml(archive, mainPart);
  const slideRelationshipIds = collectPptxSlideRelationshipIds(presentationXml);
  if (slideRelationshipIds.length > MAX_DOCUMENT_UNITS) {
    throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
  }
  const presentationRelationships = parsePackageRelationships(
    requiredXml(archive, relationshipsPartPath(mainPart)),
  );
  const relationshipById = indexRelationshipsById(presentationRelationships);
  const seenSlides = new Set<string>();
  const seenNotes = new Set<string>();
  const sourceUnits: SourceUnit[] = slideRelationshipIds.map((relationshipId, index) => {
    const relationship = relationshipById.get(relationshipId);
    if (!relationship || relationship.external || !relationshipTypeIs(relationship, 'slide')) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const slidePath = resolvePartRelationshipTarget(mainPart, relationship.target);
    if (
      !/^ppt\/slides\/slide\d+\.xml$/u.test(slidePath) ||
      !archive.has(slidePath) ||
      seenSlides.has(slidePath) ||
      contentTypeForPart(contentTypes, slidePath) !== PPTX_SLIDE_CONTENT_TYPE
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    seenSlides.add(slidePath);
    const slideText = extractPresentationText(requiredXml(archive, slidePath), 'sld');
    const notesPath = referencedPptxNotesPath(archive, contentTypes, slidePath);
    if (notesPath && seenNotes.has(notesPath)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    if (notesPath) seenNotes.add(notesPath);
    const notesText = notesPath
      ? extractPresentationText(requiredXml(archive, notesPath), 'notes')
      : '';
    return {
      text: [`Slide ${index + 1}`, slideText, ...(notesText ? ['Speaker notes:', notesText] : [])]
        .filter(Boolean)
        .join('\n\n'),
    };
  });

  return finalizeExtraction(
    'pptx',
    'slide',
    sourceUnits.length > 0 ? sourceUnits : [{ text: 'Empty presentation' }],
    maxCharacters,
    'Reconstructed slide text and speaker notes; layout, charts, media, and animations are not preserved.',
  );
}

async function extractHwpx(bytes: Uint8Array, maxCharacters: number) {
  const archive = await readSelectedArchive('hwpx', bytes);
  assertOnlyRequestedOpenXmlFormat(archive, 'hwpx');
  const mimetype = requiredArchiveText(archive, 'mimetype', false);
  const manifest = requiredXml(archive, 'META-INF/manifest.xml');
  const content = requiredXml(archive, 'Contents/content.hpf');
  const manifestState = parseHwpxManifest(manifest);
  if (mimetype !== 'application/hwp+zip' || !manifestState.canonical) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  if (manifestState.encrypted) {
    throw new ProjectChatDocumentExtractionError('attachment_encrypted');
  }

  const sectionPaths = orderedHwpxSectionPaths(content, archive);
  const sourceUnits = sectionPaths.map((path, index) => {
    const text = extractHwpxSectionText(requiredXml(archive, path));
    return { text: text ? `Section ${index + 1}\n${text}` : `Section ${index + 1}` };
  });
  return finalizeExtraction(
    'hwpx',
    'section',
    sourceUnits,
    maxCharacters,
    'Reconstructed OWPML section text; page layout, embedded objects, scripts, and tracked formatting are not preserved.',
  );
}

function extractLegacyPpt(bytes: Uint8Array, _maxCharacters: number): never {
  if (!startsWithBytes(bytes, CFB_MAGIC)) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  if (
    containsBytes(bytes, ENCRYPTED_PACKAGE_UTF16) ||
    containsBytes(bytes, ENCRYPTED_PACKAGE_ASCII) ||
    LEGACY_ENCRYPTION_MARKERS.some((marker) => containsBytes(bytes, marker))
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_encrypted');
  }
  // Legacy CFB files can retain deleted or unrelated streams. Until GOSU has a bounded FAT/mini-stream
  // reader that selects only the current PowerPoint Document stream, do not scan the container for text.
  throw new ProjectChatDocumentExtractionError('attachment_extraction_failed');
}

function extractPlainText(
  format: Extract<ProjectChatDocumentFormat, 'text' | 'markdown' | 'csv' | 'json' | 'latex'>,
  bytes: Uint8Array,
  maxCharacters: number,
) {
  if (bytes.byteLength > MAX_PLAIN_TEXT_BYTES) {
    throw new ProjectChatDocumentExtractionError('attachment_too_large');
  }
  const text = decodeUtf8(bytes)
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/gu, '\n');
  if (text.includes('\0')) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  if (format === 'json') {
    try {
      JSON.parse(text);
    } catch {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
  }
  const bounded = boundedCleanupSource(text, maxCharacters);
  return finalizeExtraction(
    format,
    'part',
    [{ text: bounded.text, truncated: bounded.truncated }],
    maxCharacters,
    'Plain UTF-8 source text; no external content, macros, or linked resources were loaded.',
  );
}

function finalizeExtraction(
  format: ProjectChatDocumentFormat,
  unitLabel: ExtractedProjectChatDocument['unitLabel'],
  sourceUnits: readonly SourceUnit[],
  maxCharacters: number,
  reconstructionNotice: string,
): ExtractedProjectChatDocument {
  if (sourceUnits.length < 1) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  if (sourceUnits.length > MAX_DOCUMENT_UNITS) {
    throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
  }
  const units: ExtractedAttachmentUnit[] = [];
  let remaining = maxCharacters;
  let truncated = false;
  for (const [index, source] of sourceUnits.entries()) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const bounded = boundedCleanupSource(source.text, remaining);
    const fullText = cleanExtractedText(bounded.text);
    const text = safeSlice(fullText, remaining);
    if (source.truncated || bounded.truncated || text.length < fullText.length) truncated = true;
    units.push({ unitNumber: index + 1, text });
    remaining -= text.length;
  }
  if (units.length < sourceUnits.length) truncated = true;
  const extractedCharacters = units.reduce((total, unit) => total + unit.text.length, 0);
  return {
    format,
    unitLabel,
    unitCount: sourceUnits.length,
    units,
    extractedCharacters,
    truncated,
    textAvailable: units.some((unit) => unit.text.trim().length > 0),
    reconstructionNotice,
  };
}

async function readSelectedArchive(
  format: Extract<ProjectChatDocumentFormat, 'docx' | 'pptx' | 'hwpx'>,
  bytes: Uint8Array,
): Promise<ArchiveEntries> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ProjectChatDocumentExtractionError('attachment_too_large');
  }
  if (startsWithBytes(bytes, CFB_MAGIC)) {
    if (
      containsBytes(bytes, ENCRYPTED_PACKAGE_UTF16) ||
      containsBytes(bytes, ENCRYPTED_PACKAGE_ASCII)
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_encrypted');
    }
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const archiveEntries = inspectZipCentralDirectory(bytes);
  let selectedExpandedBytes = 0;
  const selected = archiveEntries.filter(
    (entry) => !entry.directory && isSelectedArchivePath(format, entry.path),
  );
  for (const entry of selected) {
    if (entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
    }
    if (
      entry.originalSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.originalSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
    }
    if (format === 'hwpx' && entry.path === 'mimetype' && entry.compression !== 0) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    selectedExpandedBytes += entry.originalSize;
    if (selectedExpandedBytes > MAX_SELECTED_EXPANDED_BYTES) {
      throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
    }
  }

  const entries = new Map<string, Uint8Array>();
  for (const entry of selected) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataEnd);
    let contents: Uint8Array;
    try {
      contents =
        entry.compression === 0
          ? Uint8Array.from(compressed)
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.originalSize),
            });
    } catch (error) {
      if (isRecordWithCode(error) && error.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
      }
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    if (contents.byteLength !== entry.originalSize || crc32(contents) !== entry.crc32) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    entries.set(entry.path, contents);
  }
  return entries;
}

function inspectZipCentralDirectory(bytes: Uint8Array): readonly ZipEntry[] {
  if (bytes.byteLength < 22) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === bytes.byteLength) {
        eocdOffset = offset;
        break;
      }
    }
  }
  if (eocdOffset < 0) throw new ProjectChatDocumentExtractionError('attachment_invalid');

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > eocdOffset || centralEnd < centralOffset) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }

  let offset = centralOffset;
  const entries: Array<ZipEntry & Readonly<{ localStart: number }>> = [];
  const seenPaths = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const flags = view.getUint16(offset + 8, true);
    if ((flags & 0x2041) !== 0) {
      throw new ProjectChatDocumentExtractionError('attachment_encrypted');
    }
    const compression = view.getUint16(offset + 10, true);
    if (compression !== 0 && compression !== 8) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const versionMadeBy = view.getUint16(offset + 4, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localStart = view.getUint32(offset + 42, true);
    if (
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      originalSize === 0xffffffff ||
      localStart === 0xffffffff
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const centralRecordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (centralRecordEnd > centralEnd) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const centralName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const centralExtra = bytes.subarray(
      offset + 46 + nameLength,
      offset + 46 + nameLength + extraLength,
    );
    assertNoZip64Extra(centralExtra);
    const path = normalizeArchivePath(decodeZipEntryName(centralName, (flags & 0x800) !== 0));
    const duplicateKey = path.toLocaleLowerCase('en-US');
    if (seenPaths.has(duplicateKey)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    seenPaths.add(duplicateKey);
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (creatorSystem === 3 && (unixMode & 0xf000) === 0xa000) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    if (
      localStart + 30 > centralOffset ||
      view.getUint32(localStart, true) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const localFlags = view.getUint16(localStart + 6, true);
    const localCompression = view.getUint16(localStart + 8, true);
    const localCrc = view.getUint32(localStart + 14, true);
    const localCompressedSize = view.getUint32(localStart + 18, true);
    const localOriginalSize = view.getUint32(localStart + 22, true);
    const localNameLength = view.getUint16(localStart + 26, true);
    const localExtraLength = view.getUint16(localStart + 28, true);
    const dataStart = localStart + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      localFlags !== flags ||
      localCompression !== compression ||
      localNameLength !== nameLength ||
      dataStart < localStart ||
      dataEnd < dataStart ||
      dataEnd > centralOffset
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const localName = bytes.subarray(localStart + 30, localStart + 30 + localNameLength);
    const localExtra = bytes.subarray(
      localStart + 30 + localNameLength,
      localStart + 30 + localNameLength + localExtraLength,
    );
    if (!bytesEqual(localName, centralName)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    assertNoZip64Extra(localExtra);
    const usesDataDescriptor = (flags & 0x8) !== 0;
    if (
      (!usesDataDescriptor &&
        (localCrc !== crc ||
          localCompressedSize !== compressedSize ||
          localOriginalSize !== originalSize)) ||
      (usesDataDescriptor &&
        ((localCrc !== 0 && localCrc !== crc) ||
          (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
          (localOriginalSize !== 0 && localOriginalSize !== originalSize))) ||
      (compression === 0 && compressedSize !== originalSize)
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    entries.push({
      path,
      directory: path.endsWith('/'),
      compression,
      compressedSize,
      originalSize,
      crc32: crc,
      dataStart,
      dataEnd,
      localStart,
    });
    offset = centralRecordEnd;
  }
  if (offset !== centralEnd) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  const ranges = [...entries].sort((left, right) => left.localStart - right.localStart);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.localStart < ranges[index - 1]!.dataEnd) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
  }
  return entries.map(({ localStart: _localStart, ...entry }) => entry);
}

function decodeZipEntryName(bytes: Uint8Array, utf8: boolean) {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
}

function assertNoZip64Extra(extra: Uint8Array) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let offset = 0;
  while (offset < extra.byteLength) {
    if (offset + 4 > extra.byteLength) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const id = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + size > extra.byteLength || id === 0x0001) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    offset += size;
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function isRecordWithCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
  );
}

function normalizeArchivePath(rawPath: string) {
  const path = rawPath.normalize('NFC');
  if (
    path.length < 1 ||
    path.length > 1_024 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/u.test(path)
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const directory = path.endsWith('/');
  const parts = path.split('/');
  if (directory) parts.pop();
  if (
    parts.length < 1 ||
    parts.some(
      (part) =>
        part === '' ||
        part === '.' ||
        part === '..' ||
        ['__proto__', 'prototype', 'constructor'].includes(part.toLocaleLowerCase('en-US')),
    )
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return `${parts.join('/')}${directory ? '/' : ''}`;
}

function isSelectedArchivePath(
  format: Extract<ProjectChatDocumentFormat, 'docx' | 'pptx' | 'hwpx'>,
  path: string,
) {
  if (
    path === '[Content_Types].xml' ||
    path === '_rels/.rels' ||
    path === 'mimetype' ||
    path === 'META-INF/manifest.xml' ||
    path === 'Contents/content.hpf'
  ) {
    return true;
  }
  if (format === 'docx') {
    return (
      /^word\/(?:[A-Za-z0-9_.-]+)\.xml$/u.test(path) ||
      /^word\/_rels\/[A-Za-z0-9_.-]+\.xml\.rels$/u.test(path)
    );
  }
  if (format === 'pptx') {
    return (
      /^ppt\/[A-Za-z0-9_.-]+\.xml$/u.test(path) ||
      /^ppt\/_rels\/[A-Za-z0-9_.-]+\.xml\.rels$/u.test(path) ||
      /^ppt\/(?:slides\/slide|notesSlides\/notesSlide)\d+\.xml$/u.test(path) ||
      /^ppt\/(?:slides|notesSlides)\/_rels\/[A-Za-z0-9_.-]+\.xml\.rels$/u.test(path)
    );
  }
  return /^Contents\/(?:header|section\d+)\.xml$/u.test(path);
}

function assertOnlyRequestedOpenXmlFormat(
  archive: ArchiveEntries,
  expected: Extract<ProjectChatDocumentFormat, 'docx' | 'pptx' | 'hwpx'>,
) {
  const hasWord = [...archive.keys()].some((path) => /^word\//u.test(path));
  const hasPresentation = [...archive.keys()].some((path) => /^ppt\//u.test(path));
  const hasHwpx = archive.has('mimetype') || archive.has('Contents/content.hpf');
  if (
    (expected === 'docx' && (!hasWord || hasPresentation || hasHwpx)) ||
    (expected === 'pptx' && (!hasPresentation || hasWord || hasHwpx)) ||
    (expected === 'hwpx' &&
      (!hasHwpx || hasWord || hasPresentation || archive.has('[Content_Types].xml')))
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
}

function requiredXml(archive: ArchiveEntries, path: string) {
  const text = requiredArchiveText(archive, path, true);
  validateXml(text);
  return text;
}

function requiredArchiveText(archive: ArchiveEntries, path: string, normalizeNewlines: boolean) {
  const bytes = archive.get(path);
  if (!bytes) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  const text = decodeUtf8(bytes).replace(/^\uFEFF/u, '');
  if (text.includes('\0')) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  return normalizeNewlines ? text.replace(/\r\n?/gu, '\n') : text;
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
}

function validateXml(xml: string) {
  scanXml(xml, {});
}

function scanXml(xml: string, visitor: XmlVisitor) {
  const stack: Array<Pick<XmlStartElement, 'name' | 'localName' | 'namespaceUri' | 'depth'>> = [];
  const namespaceFrames: Array<ReadonlyMap<string, string>> = [];
  let tags = 0;
  let cursor = 0;
  let rootElements = 0;
  while (cursor < xml.length) {
    const opening = xml.indexOf('<', cursor);
    const textEnd = opening < 0 ? xml.length : opening;
    if (textEnd > cursor) {
      const source = xml.slice(cursor, textEnd);
      const decoded = decodeXmlEntities(source);
      if (stack.length === 0 && decoded.trim() !== '') {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      if (stack.length > 0 && decoded !== '') visitor.text?.(decoded, stack.length);
    }
    if (opening < 0) break;
    if (xml.startsWith('<!--', opening)) {
      const end = xml.indexOf('-->', opening + 4);
      if (end < 0 || xml.slice(opening + 4, end).includes('--')) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', opening)) {
      const end = xml.indexOf('?>', opening + 2);
      if (end < 0) throw new ProjectChatDocumentExtractionError('attachment_invalid');
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', opening)) {
      const end = xml.indexOf(']]>', opening + 9);
      if (end < 0 || stack.length === 0) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      visitor.text?.(xml.slice(opening + 9, end), stack.length);
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<!', opening)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const end = findXmlTagEnd(xml, opening + 1);
    if (end < 0) throw new ProjectChatDocumentExtractionError('attachment_invalid');
    const originalBody = xml.slice(opening + 1, end);
    let body = originalBody.trim();
    const closing = body.startsWith('/');
    if (closing) {
      body = body.slice(1).trim();
      const nameLength = xmlNameLength(body);
      const name = body.slice(0, nameLength);
      const current = stack.at(-1);
      if (
        !isValidXmlQName(name) ||
        body.slice(nameLength).trim() !== '' ||
        !current ||
        current.name !== name
      ) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      visitor.end?.(current);
      stack.pop();
      namespaceFrames.pop();
    } else {
      const parsed = parseXmlStartTag(body);
      if (stack.length === 0) rootElements += 1;
      if (rootElements > 1) throw new ProjectChatDocumentExtractionError('attachment_invalid');
      const namespaceFrame = xmlNamespaceFrame(parsed.attributes);
      const elementPrefix = parsed.name.includes(':') ? parsed.name.split(':', 1)[0]! : '';
      const namespaceUri = resolveXmlNamespace(elementPrefix, namespaceFrames, namespaceFrame);
      if (elementPrefix && !namespaceUri) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      const attributeNamespaceUris = new Map<string, string>();
      const expandedAttributeNames = new Set<string>();
      for (const name of parsed.attributes.keys()) {
        if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
        const separator = name.indexOf(':');
        const prefix = separator >= 0 ? name.slice(0, separator) : '';
        const attributeNamespaceUri = prefix
          ? resolveXmlNamespace(prefix, namespaceFrames, namespaceFrame)
          : '';
        if (prefix && !attributeNamespaceUri) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        const expandedName = `${attributeNamespaceUri}\u0000${xmlLocalName(name)}`;
        if (expandedAttributeNames.has(expandedName)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        expandedAttributeNames.add(expandedName);
        attributeNamespaceUris.set(name, attributeNamespaceUri);
      }
      const element: XmlStartElement = {
        name: parsed.name,
        localName: xmlLocalName(parsed.name),
        namespaceUri,
        attributes: parsed.attributes,
        attributeNamespaceUris,
        depth: stack.length,
        selfClosing: parsed.selfClosing,
      };
      visitor.start?.(element);
      if (parsed.selfClosing) {
        visitor.end?.(element);
      } else {
        stack.push(element);
        namespaceFrames.push(namespaceFrame);
      }
      if (stack.length > MAX_XML_DEPTH) {
        throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
      }
    }
    tags += 1;
    if (tags > MAX_XML_TAGS) {
      throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
    }
    cursor = end + 1;
  }
  if (stack.length !== 0 || rootElements !== 1) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
}

function findXmlTagEnd(xml: string, start: number) {
  let quote = '';
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index]!;
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
    else if (character === '<') return -1;
  }
  return -1;
}

function xmlNameLength(source: string) {
  let length = 0;
  while (length < source.length && /[A-Za-z0-9_.:-]/u.test(source[length]!)) length += 1;
  return length > 0 && /[A-Za-z_]/u.test(source[0]!) ? length : 0;
}

function parseXmlStartTag(source: string) {
  let body = source.trim();
  const selfClosing = body.endsWith('/');
  if (selfClosing) body = body.slice(0, -1).trimEnd();
  const nameLength = xmlNameLength(body);
  const name = body.slice(0, nameLength);
  if (!isValidXmlQName(name)) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  let cursor = nameLength;
  const attributes = new Map<string, string>();
  while (cursor < body.length) {
    while (cursor < body.length && /\s/u.test(body[cursor]!)) cursor += 1;
    if (cursor >= body.length) break;
    const attributeLength = xmlNameLength(body.slice(cursor));
    if (attributeLength === 0) throw new ProjectChatDocumentExtractionError('attachment_invalid');
    const attributeName = body.slice(cursor, cursor + attributeLength);
    if (!isValidXmlQName(attributeName)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    cursor += attributeLength;
    while (cursor < body.length && /\s/u.test(body[cursor]!)) cursor += 1;
    if (body[cursor] !== '=') throw new ProjectChatDocumentExtractionError('attachment_invalid');
    cursor += 1;
    while (cursor < body.length && /\s/u.test(body[cursor]!)) cursor += 1;
    const quote = body[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    const valueEnd = body.indexOf(quote, cursor + 1);
    if (valueEnd < 0) throw new ProjectChatDocumentExtractionError('attachment_invalid');
    if (attributes.has(attributeName)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    attributes.set(attributeName, decodeXmlEntities(body.slice(cursor + 1, valueEnd)));
    cursor = valueEnd + 1;
  }
  return { name, attributes, selfClosing } as const;
}

function isValidXmlQName(name: string) {
  const parts = name.split(':');
  return (
    (parts.length === 1 || parts.length === 2) &&
    parts.every((part) => /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(part))
  );
}

function xmlNamespaceFrame(attributes: XmlAttributes) {
  const frame = new Map<string, string>();
  for (const [name, value] of attributes) {
    const prefix = name === 'xmlns' ? '' : name.startsWith('xmlns:') ? name.slice(6) : undefined;
    if (prefix === undefined) continue;
    if (
      prefix === 'xmlns' ||
      value === XMLNS_NAMESPACE_URI ||
      (prefix === 'xml' && value !== XML_NAMESPACE_URI) ||
      (prefix !== 'xml' && value === XML_NAMESPACE_URI) ||
      (prefix !== '' && value === '')
    ) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    frame.set(prefix, value);
  }
  return frame;
}

function resolveXmlNamespace(
  prefix: string,
  namespaceFrames: readonly ReadonlyMap<string, string>[],
  currentFrame: ReadonlyMap<string, string>,
) {
  if (prefix === 'xml') return XML_NAMESPACE_URI;
  const current = currentFrame.get(prefix);
  if (current !== undefined) return current;
  for (let index = namespaceFrames.length - 1; index >= 0; index -= 1) {
    const value = namespaceFrames[index]!.get(prefix);
    if (value !== undefined) return value;
  }
  return '';
}

function xmlLocalName(name: string) {
  return name.split(':').at(-1) ?? name;
}

function parsePackageRelationships(xml: string): readonly PackageRelationship[] {
  const relationships: PackageRelationship[] = [];
  let validRoot = false;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === 'Relationships' &&
          element.namespaceUri === PACKAGE_RELATIONSHIPS_NAMESPACE;
        return;
      }
      if (
        element.depth !== 1 ||
        element.localName !== 'Relationship' ||
        element.namespaceUri !== PACKAGE_RELATIONSHIPS_NAMESPACE
      ) {
        return;
      }
      const id = attribute(element.attributes, 'Id');
      const type = attribute(element.attributes, 'Type');
      const target = attribute(element.attributes, 'Target');
      if (!id || !type || !target) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      const targetMode = attribute(element.attributes, 'TargetMode');
      const normalizedTargetMode = targetMode?.toLocaleLowerCase('en-US');
      if (
        normalizedTargetMode !== undefined &&
        normalizedTargetMode !== 'internal' &&
        normalizedTargetMode !== 'external'
      ) {
        throw new ProjectChatDocumentExtractionError('attachment_invalid');
      }
      relationships.push({
        id,
        type,
        target,
        external: normalizedTargetMode === 'external',
      });
    },
  });
  if (!validRoot) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  indexRelationshipsById(relationships);
  return relationships;
}

function indexRelationshipsById(relationships: readonly PackageRelationship[]) {
  const indexed = new Map<string, PackageRelationship>();
  for (const relationship of relationships) {
    if (indexed.has(relationship.id)) {
      throw new ProjectChatDocumentExtractionError('attachment_invalid');
    }
    indexed.set(relationship.id, relationship);
  }
  return indexed;
}

function parseContentTypes(xml: string): ContentTypes {
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();
  let validRoot = false;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === 'Types' && element.namespaceUri === CONTENT_TYPES_NAMESPACE;
        return;
      }
      if (element.depth !== 1 || element.namespaceUri !== CONTENT_TYPES_NAMESPACE) return;
      if (element.localName === 'Override') {
        const rawPartName = attribute(element.attributes, 'PartName');
        const contentType = attribute(element.attributes, 'ContentType');
        const partName = rawPartName ? canonicalPartName(rawPartName) : '';
        if (!partName || !contentType || overrides.has(partName)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        overrides.set(partName, contentType);
      } else if (element.localName === 'Default') {
        const extension = attribute(element.attributes, 'Extension')?.toLocaleLowerCase('en-US');
        const contentType = attribute(element.attributes, 'ContentType');
        if (!extension || !contentType || defaults.has(extension)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        defaults.set(extension, contentType);
      }
    },
  });
  if (!validRoot) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  return { overrides, defaults };
}

function canonicalPartName(rawPartName: string) {
  const partName = rawPartName.trim().replace(/^\/+/u, '');
  if (
    !partName ||
    partName.includes('\\') ||
    partName.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(partName)
  ) {
    return '';
  }
  return partName;
}

function contentTypeForPart(contentTypes: ContentTypes, partPath: string) {
  const override = contentTypes.overrides.get(partPath);
  if (override) return override;
  const extension = partPath.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? '';
  return contentTypes.defaults.get(extension);
}

function officeDocumentPart(
  relationships: readonly PackageRelationship[],
  expectedRoot: 'word' | 'ppt',
) {
  const candidates = relationships.filter(
    (relationship) => !relationship.external && relationshipTypeIs(relationship, 'officeDocument'),
  );
  if (candidates.length !== 1) return '';
  const part = canonicalPartName(candidates[0]!.target);
  return part.startsWith(`${expectedRoot}/`) ? part : '';
}

function relationshipTypeIs(relationship: PackageRelationship, localName: string) {
  return OFFICE_RELATIONSHIP_NAMESPACES.some(
    (namespace) => relationship.type === `${namespace}/${localName}`,
  );
}

function uniqueRelationshipByType(
  relationships: readonly PackageRelationship[],
  localName: string,
) {
  const candidates = relationships.filter((relationship) =>
    relationshipTypeIs(relationship, localName),
  );
  if (candidates.length > 1) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  return candidates[0];
}

function relationshipsPartPath(partPath: string) {
  const separator = partPath.lastIndexOf('/');
  const directory = separator >= 0 ? partPath.slice(0, separator) : '';
  const filename = partPath.slice(separator + 1);
  return `${directory ? `${directory}/` : ''}_rels/${filename}.rels`;
}

function resolvePartRelationshipTarget(sourcePart: string, target: string) {
  const separator = sourcePart.lastIndexOf('/');
  const baseDirectory = separator >= 0 ? sourcePart.slice(0, separator) : '';
  return resolveArchiveRelationshipTarget(baseDirectory, target);
}

function resolveArchiveRelationshipTarget(baseDirectory: string, target: string) {
  const decoded = target.trim();
  if (
    decoded === '' ||
    decoded.includes('\\') ||
    decoded.startsWith('/') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decoded)
  ) {
    return '';
  }
  const parts = baseDirectory.split('/');
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return '';
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function attribute(attributes: ReadonlyMap<string, string>, name: string) {
  return attributes.get(name);
}

function namespacedAttribute(
  element: XmlStartElement,
  namespaceUris: readonly string[],
  localName: string,
) {
  let result: string | undefined;
  for (const [name, value] of element.attributes) {
    if (
      xmlLocalName(name) !== localName ||
      !namespaceUris.includes(element.attributeNamespaceUris.get(name) ?? '')
    ) {
      continue;
    }
    if (result !== undefined) throw new ProjectChatDocumentExtractionError('attachment_invalid');
    result = value;
  }
  return result;
}

function unqualifiedAttribute(element: XmlStartElement, name: string) {
  return element.attributeNamespaceUris.get(name) === '' ? element.attributes.get(name) : undefined;
}

function namespaceIs(namespaceUri: string, allowed: readonly string[]) {
  return allowed.includes(namespaceUri);
}

function collectDocxReferences(xml: string) {
  const headerFooter: Array<Readonly<{ kind: 'header' | 'footer'; relationshipId: string }>> = [];
  const footnoteIds = new Set<string>();
  const endnoteIds = new Set<string>();
  let validRoot = false;
  let blockedDepth: number | undefined;
  let sectionPropertiesDepth: number | undefined;
  let paragraphDepth: number | undefined;
  let runDepth: number | undefined;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === 'document' &&
          namespaceIs(element.namespaceUri, WORDPROCESSINGML_NAMESPACES);
      }
      if (blockedDepth !== undefined) return;
      if (!namespaceIs(element.namespaceUri, WORDPROCESSINGML_NAMESPACES)) {
        blockedDepth = element.depth;
        return;
      }
      if (element.localName === 'sectPr' && sectionPropertiesDepth === undefined) {
        sectionPropertiesDepth = element.depth;
      } else if (element.localName === 'p' && paragraphDepth === undefined) {
        paragraphDepth = element.depth;
      } else if (
        element.localName === 'r' &&
        paragraphDepth !== undefined &&
        runDepth === undefined
      ) {
        runDepth = element.depth;
      }
      if (
        (element.localName === 'headerReference' || element.localName === 'footerReference') &&
        element.depth === (sectionPropertiesDepth ?? -2) + 1
      ) {
        const relationshipId = relationshipIdAttribute(element);
        if (!relationshipId) throw new ProjectChatDocumentExtractionError('attachment_invalid');
        headerFooter.push({
          kind: element.localName === 'headerReference' ? 'header' : 'footer',
          relationshipId,
        });
      } else if (
        element.localName === 'footnoteReference' &&
        element.depth === (runDepth ?? -2) + 1
      ) {
        const id = namespacedAttribute(element, WORDPROCESSINGML_NAMESPACES, 'id');
        if (!id) throw new ProjectChatDocumentExtractionError('attachment_invalid');
        footnoteIds.add(id);
      } else if (
        element.localName === 'endnoteReference' &&
        element.depth === (runDepth ?? -2) + 1
      ) {
        const id = namespacedAttribute(element, WORDPROCESSINGML_NAMESPACES, 'id');
        if (!id) throw new ProjectChatDocumentExtractionError('attachment_invalid');
        endnoteIds.add(id);
      }
    },
    end(element) {
      if (element.depth === blockedDepth) blockedDepth = undefined;
      if (element.depth === runDepth && element.localName === 'r') runDepth = undefined;
      if (element.depth === paragraphDepth && element.localName === 'p') paragraphDepth = undefined;
      if (element.depth === sectionPropertiesDepth && element.localName === 'sectPr') {
        sectionPropertiesDepth = undefined;
      }
    },
  });
  if (!validRoot) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  if (headerFooter.length + footnoteIds.size + endnoteIds.size > MAX_DOCUMENT_UNITS) {
    throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
  }
  return { headerFooter, footnoteIds, endnoteIds } as const;
}

function collectPptxSlideRelationshipIds(xml: string) {
  const ids: string[] = [];
  let validRoot = false;
  let slideListDepth: number | undefined;
  let blockedDepth: number | undefined;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === 'presentation' &&
          namespaceIs(element.namespaceUri, PRESENTATIONML_NAMESPACES);
      }
      if (blockedDepth !== undefined) return;
      if (!namespaceIs(element.namespaceUri, PRESENTATIONML_NAMESPACES)) {
        blockedDepth = element.depth;
        return;
      }
      if (element.depth === 1 && element.localName === 'sldIdLst') {
        if (slideListDepth !== undefined) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        slideListDepth = element.depth;
        return;
      }
      if (element.localName !== 'sldId' || element.depth !== (slideListDepth ?? -2) + 1) return;
      const id = relationshipIdAttribute(element);
      if (!id) throw new ProjectChatDocumentExtractionError('attachment_invalid');
      ids.push(id);
    },
    end(element) {
      if (element.depth === blockedDepth) blockedDepth = undefined;
      if (
        element.depth === slideListDepth &&
        element.localName === 'sldIdLst' &&
        namespaceIs(element.namespaceUri, PRESENTATIONML_NAMESPACES)
      ) {
        slideListDepth = undefined;
      }
    },
  });
  if (!validRoot) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  return ids;
}

function relationshipIdAttribute(element: XmlStartElement) {
  return namespacedAttribute(element, OFFICE_RELATIONSHIP_NAMESPACES, 'id');
}

function referencedPptxNotesPath(
  archive: ArchiveEntries,
  contentTypes: ContentTypes,
  slidePath: string,
) {
  const relationshipPath = relationshipsPartPath(slidePath);
  if (!archive.has(relationshipPath)) return '';
  const relationships = parsePackageRelationships(requiredXml(archive, relationshipPath));
  const noteRelationship = uniqueRelationshipByType(relationships, 'notesSlide');
  if (!noteRelationship) return '';
  if (noteRelationship.external) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const resolved = resolvePartRelationshipTarget(slidePath, noteRelationship.target);
  if (
    !/^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(resolved) ||
    !archive.has(resolved) ||
    contentTypeForPart(contentTypes, resolved) !== PPTX_NOTES_CONTENT_TYPE
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return resolved;
}

function labelledUnit(label: string, text: string): SourceUnit {
  return { text: text ? `${label}\n${text}` : label };
}

type MarkupTextPolicy = Readonly<{
  rootLocalName: string;
  rootNamespaces: readonly string[];
  allowedNamespaces: readonly string[];
  paragraphNamespaces: readonly string[];
  textNamespaces: readonly string[];
  container?: Readonly<{
    localName: string;
    namespaces: readonly string[];
    idNamespaces: readonly string[];
    ids: ReadonlySet<string>;
  }>;
}>;

function extractMarkupText(xml: string, policy: MarkupTextPolicy) {
  const paragraphs: string[] = [];
  const foundContainerIds = new Set<string>();
  const seenContainerIds = new Set<string>();
  let activeContainerDepth: number | undefined;
  let activeParagraph: { depth: number; text: string[] } | undefined;
  let activeTextDepth: number | undefined;
  let blockedDepth: number | undefined;
  let validRoot = false;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === policy.rootLocalName &&
          namespaceIs(element.namespaceUri, policy.rootNamespaces);
      }
      if (blockedDepth !== undefined) return;
      if (!namespaceIs(element.namespaceUri, policy.allowedNamespaces)) {
        blockedDepth = element.depth;
        return;
      }
      if (
        policy.container &&
        element.localName === policy.container.localName &&
        namespaceIs(element.namespaceUri, policy.container.namespaces)
      ) {
        const id = namespacedAttribute(element, policy.container.idNamespaces, 'id');
        if (element.depth !== 1 || !id || seenContainerIds.has(id)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        seenContainerIds.add(id);
        if (policy.container.ids.has(id)) {
          if (foundContainerIds.has(id)) {
            throw new ProjectChatDocumentExtractionError('attachment_invalid');
          }
          if (activeContainerDepth !== undefined) {
            throw new ProjectChatDocumentExtractionError('attachment_invalid');
          }
          activeContainerDepth = element.depth;
          foundContainerIds.add(id);
        }
      }
      const included = !policy.container || activeContainerDepth !== undefined;
      if (!included) return;
      if (
        element.localName === 'p' &&
        namespaceIs(element.namespaceUri, policy.paragraphNamespaces)
      ) {
        if (activeParagraph) throw new ProjectChatDocumentExtractionError('attachment_invalid');
        activeParagraph = { depth: element.depth, text: [] };
      }
      if (element.localName === 't' && namespaceIs(element.namespaceUri, policy.textNamespaces)) {
        if (activeTextDepth !== undefined) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        if (activeParagraph) activeTextDepth = element.depth;
      }
      if (
        activeParagraph &&
        ['br', 'lineBreak'].includes(element.localName) &&
        namespaceIs(element.namespaceUri, policy.textNamespaces)
      ) {
        activeParagraph.text.push('\n');
      } else if (
        activeParagraph &&
        element.localName === 'tab' &&
        namespaceIs(element.namespaceUri, policy.textNamespaces)
      ) {
        activeParagraph.text.push('\t');
      }
    },
    text(text, depth) {
      if (blockedDepth === undefined && activeTextDepth !== undefined && depth > activeTextDepth) {
        activeParagraph?.text.push(text);
      }
    },
    end(element) {
      if (element.depth === blockedDepth) {
        blockedDepth = undefined;
        return;
      }
      if (
        element.depth === activeTextDepth &&
        element.localName === 't' &&
        namespaceIs(element.namespaceUri, policy.textNamespaces)
      ) {
        activeTextDepth = undefined;
      }
      if (
        activeParagraph &&
        element.depth === activeParagraph.depth &&
        element.localName === 'p' &&
        namespaceIs(element.namespaceUri, policy.paragraphNamespaces)
      ) {
        const text = cleanExtractedText(activeParagraph.text.join(''));
        if (text) paragraphs.push(text);
        activeParagraph = undefined;
      }
      if (
        policy.container &&
        element.depth === activeContainerDepth &&
        element.localName === policy.container.localName &&
        namespaceIs(element.namespaceUri, policy.container.namespaces)
      ) {
        activeContainerDepth = undefined;
      }
    },
  });
  if (!validRoot) throw new ProjectChatDocumentExtractionError('attachment_invalid');
  if (policy.container && [...policy.container.ids].some((id) => !foundContainerIds.has(id))) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return paragraphs.join('\n');
}

function extractWordprocessingText(xml: string, rootLocalName: string) {
  return extractMarkupText(xml, {
    rootLocalName,
    rootNamespaces: WORDPROCESSINGML_NAMESPACES,
    allowedNamespaces: WORDPROCESSINGML_NAMESPACES,
    paragraphNamespaces: WORDPROCESSINGML_NAMESPACES,
    textNamespaces: WORDPROCESSINGML_NAMESPACES,
  });
}

function extractPresentationText(xml: string, rootLocalName: string) {
  return extractMarkupText(xml, {
    rootLocalName,
    rootNamespaces: PRESENTATIONML_NAMESPACES,
    allowedNamespaces: [...PRESENTATIONML_NAMESPACES, ...DRAWINGML_NAMESPACES],
    paragraphNamespaces: DRAWINGML_NAMESPACES,
    textNamespaces: DRAWINGML_NAMESPACES,
  });
}

function extractHwpxSectionText(xml: string) {
  return extractMarkupText(xml, {
    rootLocalName: 'sec',
    rootNamespaces: [HWPX_SECTION_NAMESPACE],
    allowedNamespaces: [HWPX_SECTION_NAMESPACE, HWPX_PARAGRAPH_NAMESPACE],
    paragraphNamespaces: [HWPX_PARAGRAPH_NAMESPACE],
    textNamespaces: [HWPX_PARAGRAPH_NAMESPACE],
  });
}

function extractReferencedWordNotes(
  xml: string,
  noteElementName: string,
  ids: ReadonlySet<string>,
) {
  return extractMarkupText(xml, {
    rootLocalName: noteElementName === 'footnote' ? 'footnotes' : 'endnotes',
    rootNamespaces: WORDPROCESSINGML_NAMESPACES,
    allowedNamespaces: WORDPROCESSINGML_NAMESPACES,
    paragraphNamespaces: WORDPROCESSINGML_NAMESPACES,
    textNamespaces: WORDPROCESSINGML_NAMESPACES,
    container: {
      localName: noteElementName,
      namespaces: WORDPROCESSINGML_NAMESPACES,
      idNamespaces: WORDPROCESSINGML_NAMESPACES,
      ids,
    },
  });
}

function decodeXmlEntities(text: string) {
  const decoded = text.replace(
    /&(#(?:x[0-9A-Fa-f]+|\d+)|amp|lt|gt|quot|apos);/gu,
    (_match, entity: string) => {
      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default: {
          const hexadecimal = entity.startsWith('#x');
          const value = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
          if (!Number.isSafeInteger(value) || value < 0 || value > 0x10ffff) {
            throw new ProjectChatDocumentExtractionError('attachment_invalid');
          }
          return String.fromCodePoint(value);
        }
      }
    },
  );
  if (decoded.includes('&') && /&(?!(?:#(?:x[0-9A-Fa-f]+|\d+)|amp|lt|gt|quot|apos);)/u.test(text)) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return decoded;
}

function docxPartLabel(path: string) {
  if (path === 'word/document.xml') return 'Document body';
  if (path === 'word/footnotes.xml') return 'Footnotes';
  if (path === 'word/endnotes.xml') return 'Endnotes';
  const header = /^word\/header(\d+)\.xml$/u.exec(path)?.[1];
  if (header) return `Header ${header}`;
  const footer = /^word\/footer(\d+)\.xml$/u.exec(path)?.[1];
  return footer ? `Footer ${footer}` : 'Document part';
}

function parseHwpxManifest(xml: string) {
  let rootNamespace: string | undefined;
  let validRoot = false;
  let canonical = false;
  let encrypted = false;
  scanXml(xml, {
    start(element) {
      if (element.depth === 0) {
        validRoot =
          element.localName === 'manifest' && element.namespaceUri === HWPX_MANIFEST_NAMESPACE;
        rootNamespace = element.namespaceUri;
        return;
      }
      if (
        element.localName === 'encryption-data' &&
        element.namespaceUri === HWPX_MANIFEST_NAMESPACE
      ) {
        encrypted = true;
      }
      if (
        element.depth !== 1 ||
        element.localName !== 'file-entry' ||
        element.namespaceUri !== rootNamespace
      ) {
        return;
      }
      if (
        namespacedAttribute(element, [HWPX_MANIFEST_NAMESPACE], 'full-path') === '/' &&
        namespacedAttribute(element, [HWPX_MANIFEST_NAMESPACE], 'media-type') ===
          'application/hwp+zip'
      ) {
        canonical = true;
      }
    },
  });
  if (!validRoot || rootNamespace === undefined) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return { canonical, encrypted } as const;
}

function orderedHwpxSectionPaths(content: string, archive: ArchiveEntries) {
  const itemById = new Map<string, string>();
  const allItemIds = new Set<string>();
  const paths: string[] = [];
  const selectedPaths = new Set<string>();
  let rootNamespace: string | undefined;
  let validRoot = false;
  let manifestDepth: number | undefined;
  let spineDepth: number | undefined;
  let sawManifest = false;
  let sawSpine = false;
  scanXml(content, {
    start(element) {
      if (element.depth === 0) {
        validRoot = element.localName === 'package' && element.namespaceUri === HWPX_OPF_NAMESPACE;
        rootNamespace = element.namespaceUri;
        return;
      }
      if (element.namespaceUri !== rootNamespace) return;
      if (element.depth === 1 && element.localName === 'manifest' && manifestDepth === undefined) {
        manifestDepth = element.depth;
        sawManifest = true;
        return;
      }
      if (element.depth === 1 && element.localName === 'spine' && spineDepth === undefined) {
        spineDepth = element.depth;
        sawSpine = true;
        return;
      }
      if (
        element.localName === 'item' &&
        manifestDepth !== undefined &&
        element.depth === manifestDepth + 1
      ) {
        const id = unqualifiedAttribute(element, 'id');
        const href = unqualifiedAttribute(element, 'href');
        if (!id || !href || allItemIds.has(id)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        allItemIds.add(id);
        const path = canonicalHwpxSectionHref(href);
        if (path) itemById.set(id, path);
      } else if (
        element.localName === 'itemref' &&
        spineDepth !== undefined &&
        element.depth === spineDepth + 1
      ) {
        const idref = unqualifiedAttribute(element, 'idref');
        const path = idref ? itemById.get(idref) : undefined;
        if (!path) throw new ProjectChatDocumentExtractionError('attachment_invalid');
        if (selectedPaths.has(path)) {
          throw new ProjectChatDocumentExtractionError('attachment_invalid');
        }
        if (paths.length >= MAX_DOCUMENT_UNITS) {
          throw new ProjectChatDocumentExtractionError('attachment_archive_limit');
        }
        selectedPaths.add(path);
        paths.push(path);
      }
    },
    end(element) {
      if (element.depth === manifestDepth && element.localName === 'manifest') {
        manifestDepth = undefined;
      }
      if (element.depth === spineDepth && element.localName === 'spine') {
        spineDepth = undefined;
      }
    },
  });
  if (
    !validRoot ||
    rootNamespace === undefined ||
    !sawManifest ||
    !sawSpine ||
    paths.length < 1 ||
    paths.some((path) => !archive.has(path))
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  return paths;
}

function canonicalHwpxSectionHref(href: string) {
  const decoded = href.trim().replace(/^\.\//u, '');
  if (
    decoded.includes('\\') ||
    decoded.startsWith('/') ||
    decoded.split('/').some((part) => part === '..') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decoded)
  ) {
    throw new ProjectChatDocumentExtractionError('attachment_invalid');
  }
  const path = decoded.startsWith('Contents/') ? decoded : `Contents/${decoded}`;
  return /^Contents\/section\d+\.xml$/u.test(path) ? path : '';
}

function cleanExtractedText(text: string) {
  return replaceDisallowedControlCharacters(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function replaceDisallowedControlCharacters(text: string) {
  // eslint-disable-next-line no-control-regex -- these are precisely the disallowed C0/DEL code points
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ');
}

function boundedCleanupSource(text: string, maxCharacters: number) {
  const inputLimit = Math.min(
    MAX_CLEANUP_INPUT_CHARACTERS,
    Math.max(maxCharacters + CLEANUP_INPUT_OVERREAD, maxCharacters * CLEANUP_INPUT_MULTIPLIER),
  );
  const bounded = safeSlice(text, inputLimit);
  return { text: bounded, truncated: bounded.length < text.length } as const;
}

function safeSlice(text: string, maxCharacters: number) {
  let result = text.slice(0, maxCharacters);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

function startsWithBytes(bytes: Uint8Array, prefix: Uint8Array) {
  return (
    bytes.byteLength >= prefix.byteLength && prefix.every((value, index) => bytes[index] === value)
  );
}

function containsBytes(bytes: Uint8Array, needle: Uint8Array) {
  if (needle.byteLength === 0 || needle.byteLength > bytes.byteLength) return false;
  const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pattern = Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength);
  return haystack.indexOf(pattern) >= 0;
}
