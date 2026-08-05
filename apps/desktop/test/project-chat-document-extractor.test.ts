import { strToU8, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  extractProjectChatDocument,
  ProjectChatDocumentExtractionError,
  type ProjectChatDocumentFormat,
} from '../src/main/project-chat-document-extractor';

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WORDPROCESSINGML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PRESENTATIONML_NAMESPACE = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWINGML_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const OFFICE_RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HWPX_SECTION_NAMESPACE = 'http://www.hancom.co.kr/hwpml/2011/section';
const HWPX_PARAGRAPH_NAMESPACE = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

function xml(value: string) {
  return strToU8(`<?xml version="1.0" encoding="UTF-8"?>${value}`);
}

function docxFixture(
  document = `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}"><w:body><w:p><w:r><w:t>Main body</w:t><w:footnoteReference w:id="2"/></w:r></w:p><w:sectPr><w:headerReference r:id="rHeader2"/><w:headerReference r:id="rHeader1"/></w:sectPr></w:body></w:document>`,
  extra: Zippable = {},
) {
  return zipSync({
    '[Content_Types].xml': xml(
      `<Types xmlns="${CONTENT_TYPES_NAMESPACE}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
    ),
    '_rels/.rels': xml(
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="${OFFICE_DOCUMENT_RELATIONSHIP}" Target="word/document.xml"/></Relationships>`,
    ),
    'word/document.xml': xml(document),
    'word/_rels/document.xml.rels': xml(
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rHeader2" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/header" Target="header2.xml"/><Relationship Id="rFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
    ),
    'word/header2.xml': xml(
      `<w:hdr xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:p><w:r><w:t>Header two</w:t></w:r></w:p></w:hdr>`,
    ),
    'word/header1.xml': xml(
      `<w:hdr xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:p><w:r><w:t>Header one</w:t></w:r></w:p></w:hdr>`,
    ),
    'word/footnotes.xml': xml(
      `<w:footnotes xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:footnote w:id="2"><w:p><w:r><w:t>Evidence note</w:t></w:r></w:p></w:footnote><w:footnote w:id="99"><w:p><w:r><w:t>Deleted note</w:t></w:r></w:p></w:footnote></w:footnotes>`,
    ),
    ...extra,
  });
}

function pptxFixture(extra: Zippable = {}) {
  return zipSync({
    '[Content_Types].xml': xml(
      `<Types xmlns="${CONTENT_TYPES_NAMESPACE}"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide10.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide7.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`,
    ),
    '_rels/.rels': xml(
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    ),
    'ppt/presentation.xml': xml(
      `<p:presentation xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}"><p:sldIdLst><p:sldId id="10" r:id="rSlide10"/><p:sldId id="2" r:id="rSlide2"/></p:sldIdLst></p:presentation>`,
    ),
    'ppt/_rels/presentation.xml.rels': xml(
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rSlide2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rSlide10" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/slide" Target="slides/slide10.xml"/></Relationships>`,
    ),
    'ppt/slides/slide10.xml': xml(
      `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}"><a:p><a:r><a:t>Tenth slide</a:t></a:r></a:p></p:sld>`,
    ),
    'ppt/slides/slide2.xml': xml(
      `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}"><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>`,
    ),
    'ppt/slides/_rels/slide2.xml.rels': xml(
      `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
    ),
    'ppt/notesSlides/notesSlide7.xml': xml(
      `<p:notes xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}"><a:p><a:r><a:t>Explain the ablation.</a:t></a:r></a:p></p:notes>`,
    ),
    ...extra,
  });
}

function hwpxFixture(
  mimetype = 'application/hwp+zip',
  section = `<hs:sec xmlns:hs="${HWPX_SECTION_NAMESPACE}" xmlns:hp="${HWPX_PARAGRAPH_NAMESPACE}"><hp:p><hp:run><hp:t>한국어 연구 결과</hp:t></hp:run></hp:p></hs:sec>`,
  extra: Zippable = {},
) {
  return zipSync({
    mimetype: [strToU8(mimetype), { level: 0 }],
    'META-INF/manifest.xml': xml(
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/></manifest:manifest>',
    ),
    'Contents/content.hpf': xml(
      '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="s1" href="section1.xml"/><opf:item id="s0" href="section0.xml"/></opf:manifest><opf:spine><opf:itemref idref="s1"/><opf:itemref idref="s0"/></opf:spine></opf:package>',
    ),
    'Contents/header.xml': xml('<hh:head xmlns:hh="urn:hh"/>'),
    'Contents/section0.xml': xml(section),
    'Contents/section1.xml': xml(
      `<hs:sec xmlns:hs="${HWPX_SECTION_NAMESPACE}" xmlns:hp="${HWPX_PARAGRAPH_NAMESPACE}"><hp:p><hp:run><hp:t>첫 번째로 읽을 구역</hp:t></hp:run></hp:p></hs:sec>`,
    ),
    ...extra,
  });
}

function legacyPptFixture(text: string) {
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const marker = Buffer.from('PowerPoint Document', 'utf16le');
  const payload = Buffer.from(text, 'utf16le');
  const record = Buffer.alloc(8);
  record.writeUInt16LE(0, 0);
  record.writeUInt16LE(4_000, 2);
  record.writeUInt32LE(payload.byteLength, 4);
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(32), marker, record, payload]));
}

async function expectCode(operation: Promise<unknown>, code: string) {
  try {
    await operation;
    expect.unreachable(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectChatDocumentExtractionError);
    expect((error as ProjectChatDocumentExtractionError).code).toBe(code);
  }
}

function patchZipEntry(
  source: Uint8Array,
  expectedName: string,
  patch: (view: DataView, centralOffset: number, localOffset: number) => void,
) {
  const bytes = Uint8Array.from(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name !== expectedName) continue;
    patch(view, offset, view.getUint32(offset + 42, true));
    return bytes;
  }
  throw new Error(`missing_zip_entry:${expectedName}`);
}

function zipLocalOffset(source: Uint8Array, expectedName: string) {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  for (let offset = 0; offset + 46 <= source.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(source.subarray(offset + 46, offset + 46 + nameLength));
    if (name === expectedName) return view.getUint32(offset + 42, true);
  }
  throw new Error(`missing_zip_entry:${expectedName}`);
}

describe('extractProjectChatDocument', () => {
  it('follows DOCX references in document order and excludes orphaned or deleted note content', async () => {
    const result = await extractProjectChatDocument(
      'docx',
      docxFixture(undefined, {
        'word/header9.xml': xml(
          `<w:hdr xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:p><w:r><w:t>Orphaned header</w:t></w:r></w:p></w:hdr>`,
        ),
      }),
      60_000,
    );

    expect(result).toMatchObject({
      format: 'docx',
      unitLabel: 'part',
      unitCount: 4,
      extractedCharacters: expect.any(Number),
      truncated: false,
      textAvailable: true,
    });
    expect(result.units.map((unit) => unit.text)).toEqual([
      'Document body\nMain body',
      'Header 2\nHeader two',
      'Header 1\nHeader one',
      'Footnotes\nEvidence note',
    ]);
    expect(result.units.map((unit) => unit.text).join('\n')).not.toContain('Orphaned header');
    expect(result.units.map((unit) => unit.text).join('\n')).not.toContain('Deleted note');
    expect(result.reconstructionNotice).toContain('WordprocessingML');
  });

  it('ignores foreign-namespace DOCX references, relationship attributes, and text', async () => {
    const document = `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:evil="urn:evil"><w:body><w:p><w:r><w:t>Visible body<evil:span>NESTED_SECRET</evil:span></w:t><evil:t>FOREIGN_TEXT_SECRET</evil:t></w:r></w:p><w:sectPr><evil:headerReference evil:id="rHeader9"/></w:sectPr></w:body></w:document>`;
    const result = await extractProjectChatDocument(
      'docx',
      docxFixture(document, {
        '[Content_Types].xml': xml(
          `<Types xmlns="${CONTENT_TYPES_NAMESPACE}"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header9.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`,
        ),
        'word/_rels/document.xml.rels': xml(
          `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rHeader9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header9.xml"/></Relationships>`,
        ),
        'word/header9.xml': xml(
          `<w:hdr xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:p><w:r><w:t>ORPHAN_SECRET</w:t></w:r></w:p></w:hdr>`,
        ),
      }),
      60_000,
    );

    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.text).toBe('Document body\nVisible body');
    expect(result.units[0]?.text).not.toContain('SECRET');

    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(
          `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:evil="urn:evil"><w:body><w:sectPr><w:headerReference evil:id="rHeader9"/></w:sectPr></w:body></w:document>`,
        ),
        60_000,
      ),
      'attachment_invalid',
    );

    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(
          `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:body><W:p><W:r><W:t>CASE_FOLDED_SECRET</W:t></W:r></W:p></w:body></w:document>`,
        ),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects duplicate definitions of a referenced DOCX note', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          'word/footnotes.xml': xml(
            `<w:footnotes xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:footnote w:id="2"><w:p><w:r><w:t>Referenced note</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:t>DUPLICATE_SECRET</w:t></w:r></w:p></w:footnote></w:footnotes>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects malformed XML QNames that could spoof a relationship attribute', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(
          `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}"><w:body><w:sectPr><w:headerReference r:x:id="rHeader1"/></w:sectPr></w:body></w:document>`,
        ),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects reserved XML namespace prefix rebinding', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(
          `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}" xmlns:xmlns="${WORDPROCESSINGML_NAMESPACE}"><w:body><w:sectPr><xmlns:headerReference r:id="rHeader1"/></w:sectPr></w:body></w:document>`,
        ),
        60_000,
      ),
      'attachment_invalid',
    );

    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(
          `<w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}" xmlns:xml="${WORDPROCESSINGML_NAMESPACE}"><w:body><w:p><w:r><w:t>SECRET</w:t></w:r></w:p></w:body></w:document>`,
        ),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects unknown package relationship target modes instead of treating them as internal', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          'word/_rels/document.xml.rels': xml(
            `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml" TargetMode="Bogus"/><Relationship Id="rHeader2" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/header" Target="header2.xml"/><Relationship Id="rFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects note containers nested inside a referenced DOCX note', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          'word/footnotes.xml': xml(
            `<w:footnotes xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:footnote w:id="2"><w:p><w:r><w:t>Referenced note</w:t></w:r></w:p><w:footnote w:id="99"><w:p><w:r><w:t>NESTED_SECRET</w:t></w:r></w:p></w:footnote></w:footnote></w:footnotes>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('follows PPTX presentation relationship order and ignores orphan slides and notes', async () => {
    const result = await extractProjectChatDocument(
      'pptx',
      pptxFixture({
        'ppt/slides/slide99.xml': xml(
          `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}"><a:p><a:r><a:t>Orphan slide</a:t></a:r></a:p></p:sld>`,
        ),
        'ppt/notesSlides/notesSlide99.xml': xml(
          `<p:notes xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}"><a:p><a:r><a:t>Orphan note</a:t></a:r></a:p></p:notes>`,
        ),
      }),
      60_000,
    );

    expect(result).toMatchObject({ format: 'pptx', unitLabel: 'slide', unitCount: 2 });
    expect(result.units[0]?.text).toContain('Slide 1');
    expect(result.units[0]?.text).toContain('Tenth slide');
    expect(result.units[1]?.text).toContain('Slide 2');
    expect(result.units[1]?.text).toContain('Second slide');
    expect(result.units[1]?.text).toContain('Speaker notes:\n\nExplain the ablation.');
    expect(result.units.map((unit) => unit.text).join('\n')).not.toContain('Orphan');
  });

  it('ignores foreign-namespace PPTX slide references and drawing text', async () => {
    const result = await extractProjectChatDocument(
      'pptx',
      pptxFixture({
        'ppt/presentation.xml': xml(
          `<p:presentation xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}" xmlns:evil="urn:evil"><p:sldIdLst><p:sldId id="10" r:id="rSlide10"/><evil:sldId evil:id="rSlide2"/></p:sldIdLst></p:presentation>`,
        ),
        'ppt/slides/slide10.xml': xml(
          `<p:sld xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:evil="urn:evil"><a:p><a:r><a:t>Visible slide<evil:span>NESTED_SECRET</evil:span></a:t><evil:t>FOREIGN_TEXT_SECRET</evil:t></a:r></a:p></p:sld>`,
        ),
      }),
      60_000,
    );

    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.text).toContain('Visible slide');
    expect(result.units[0]?.text).not.toContain('Second slide');
    expect(result.units[0]?.text).not.toContain('SECRET');

    await expectCode(
      extractProjectChatDocument(
        'pptx',
        pptxFixture({
          'ppt/presentation.xml': xml(
            `<p:presentation xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:evil="urn:evil"><p:sldIdLst><p:sldId id="10" evil:id="rSlide10"/></p:sldIdLst></p:presentation>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects shared speaker-note parts and too many slides before reconstruction', async () => {
    await expectCode(
      extractProjectChatDocument(
        'pptx',
        pptxFixture({
          'ppt/slides/_rels/slide10.xml.rels': xml(
            `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );

    const slideIds = Array.from(
      { length: 501 },
      (_, index) => `<p:sldId id="${index + 1}" r:id="rSlide${index + 1}"/>`,
    ).join('');
    await expectCode(
      extractProjectChatDocument(
        'pptx',
        pptxFixture({
          'ppt/presentation.xml': xml(
            `<p:presentation xmlns:p="${PRESENTATIONML_NAMESPACE}" xmlns:r="${OFFICE_RELATIONSHIP_NAMESPACE}"><p:sldIdLst>${slideIds}</p:sldIdLst></p:presentation>`,
          ),
        }),
        60_000,
      ),
      'attachment_archive_limit',
    );
  });

  it('validates HWPX packaging and follows content.hpf spine order with Korean text', async () => {
    const result = await extractProjectChatDocument('hwpx', hwpxFixture(), 60_000);

    expect(result).toMatchObject({ format: 'hwpx', unitLabel: 'section', unitCount: 2 });
    expect(result.units[0]?.text).toBe('Section 1\n첫 번째로 읽을 구역');
    expect(result.units[1]?.text).toBe('Section 2\n한국어 연구 결과');
    expect(result.reconstructionNotice).toContain('OWPML');
  });

  it('ignores foreign-namespace text in HWPX sections', async () => {
    const section = `<hs:sec xmlns:hs="${HWPX_SECTION_NAMESPACE}" xmlns:hp="${HWPX_PARAGRAPH_NAMESPACE}" xmlns:evil="urn:evil"><hp:p><hp:run><hp:t>공개 본문<evil:span>NESTED_SECRET</evil:span></hp:t><evil:t>FOREIGN_TEXT_SECRET</evil:t></hp:run></hp:p></hs:sec>`;
    const result = await extractProjectChatDocument(
      'hwpx',
      hwpxFixture(undefined, section),
      60_000,
    );
    expect(result.units.map((unit) => unit.text).join('\n')).toContain('공개 본문');
    expect(result.units.map((unit) => unit.text).join('\n')).not.toContain('SECRET');
  });

  it('does not decode an HWPX spine href more than once', async () => {
    await expectCode(
      extractProjectChatDocument(
        'hwpx',
        hwpxFixture('application/hwp+zip', undefined, {
          'Contents/content.hpf': xml(
            '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="s0" href="section&amp;#48;.xml"/></opf:manifest><opf:spine><opf:itemref idref="s0"/></opf:spine></opf:package>',
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('decodes bounded UTF-8 text formats and validates JSON', async () => {
    const cases: Array<[ProjectChatDocumentFormat, string]> = [
      ['text', 'plain text'],
      ['markdown', '# Heading'],
      ['csv', 'name,value\nalpha,1'],
      ['latex', '\\alpha + \\beta'],
      ['json', '{"metric":0.95}'],
    ];
    for (const [format, source] of cases) {
      const result = await extractProjectChatDocument(format, strToU8(source), 7);
      expect(result).toMatchObject({
        format,
        unitLabel: 'part',
        unitCount: 1,
        extractedCharacters: 7,
        truncated: source.length > 7,
      });
      expect(result.units[0]?.text).toBe(source.slice(0, 7));
    }
    await expectCode(
      extractProjectChatDocument('json', strToU8('{not-json}'), 60_000),
      'attachment_invalid',
    );
  });

  it('fails closed on legacy CFB PowerPoint rather than exposing unrelated stream text', async () => {
    await expectCode(
      extractProjectChatDocument(
        'ppt',
        legacyPptFixture('UNRELATED_OR_DELETED_STREAM_SENTINEL'),
        60_000,
      ),
      'attachment_extraction_failed',
    );
    await expectCode(
      extractProjectChatDocument('ppt', new Uint8Array(Buffer.from('not a ppt')), 60_000),
      'attachment_invalid',
    );
  });

  it('rejects a ZIP whose canonical manifest belongs to another document format', async () => {
    await expectCode(
      extractProjectChatDocument('docx', pptxFixture(), 60_000),
      'attachment_invalid',
    );
    await expectCode(
      extractProjectChatDocument('hwpx', hwpxFixture('application/zip'), 60_000),
      'attachment_invalid',
    );
  });

  it('rejects DTD and ENTITY declarations before extracting XML text', async () => {
    const hostile = `<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>`;
    await expectCode(
      extractProjectChatDocument('docx', docxFixture(hostile), 60_000),
      'attachment_invalid',
    );
  });

  it('does not accept content types, relationships, or HWPX manifest entries spoofed in comments or CDATA', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          '[Content_Types].xml': xml(
            `<Types xmlns="${CONTENT_TYPES_NAMESPACE}"><!--<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>--><Override PartName="/word/other.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          '_rels/.rels': xml(
            `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><![CDATA[<Relationship Id="fake" Type="${OFFICE_DOCUMENT_RELATIONSHIP}" Target="word/document.xml"/>]]><Relationship Id="actual" Type="urn:not-office-document" Target="word/document.xml"/></Relationships>`,
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
    await expectCode(
      extractProjectChatDocument(
        'hwpx',
        hwpxFixture('application/hwp+zip', undefined, {
          'META-INF/manifest.xml': xml(
            '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" xmlns:evil="urn:evil"><!--<manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/>--><evil:file-entry evil:full-path="/" evil:media-type="application/hwp+zip"/></manifest:manifest>',
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
    await expectCode(
      extractProjectChatDocument(
        'hwpx',
        hwpxFixture('application/hwp+zip', undefined, {
          'Contents/content.hpf': xml(
            '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="s0" href="section0.xml"/></opf:manifest><opf:spine/></opf:package>',
          ),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects archive traversal and normalized duplicate paths', async () => {
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, { '../outside.xml': xml('<outside/>') }),
        60_000,
      ),
      'attachment_invalid',
    );
    await expectCode(
      extractProjectChatDocument(
        'docx',
        docxFixture(undefined, {
          'Extra/Marker.xml': xml('<marker/>'),
          'extra/marker.xml': xml('<marker/>'),
        }),
        60_000,
      ),
      'attachment_invalid',
    );
  });

  it('rejects excessive compression ratios and encrypted ZIP flags with distinct codes', async () => {
    const compressedBomb = docxFixture(undefined, {
      'word/footer9.xml': xml(
        `<w:ftr xmlns:w="${WORDPROCESSINGML_NAMESPACE}"><w:p><w:t>${'A'.repeat(200_000)}</w:t></w:p></w:ftr>`,
      ),
    });
    await expectCode(
      extractProjectChatDocument('docx', compressedBomb, 60_000),
      'attachment_archive_limit',
    );

    const encrypted = new Uint8Array(docxFixture());
    const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    for (let offset = 0; offset + 46 <= encrypted.byteLength; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
        break;
      }
    }
    await expectCode(extractProjectChatDocument('docx', encrypted, 60_000), 'attachment_encrypted');
  });

  it('cross-validates ZIP central/local sizes and bounds actual inflated output', async () => {
    const localMismatch = patchZipEntry(
      docxFixture(),
      'word/document.xml',
      (view, _centralOffset, localOffset) => {
        view.setUint32(localOffset + 22, view.getUint32(localOffset + 22, true) - 1, true);
      },
    );
    await expectCode(
      extractProjectChatDocument('docx', localMismatch, 60_000),
      'attachment_invalid',
    );

    const understatedOutput = patchZipEntry(
      docxFixture(),
      'word/document.xml',
      (view, centralOffset, localOffset) => {
        view.setUint32(centralOffset + 24, 1, true);
        view.setUint32(localOffset + 22, 1, true);
      },
    );
    await expectCode(
      extractProjectChatDocument('docx', understatedOutput, 60_000),
      'attachment_archive_limit',
    );

    const source = docxFixture();
    const aliasedPayload = patchZipEntry(source, 'word/header1.xml', (view, centralOffset) => {
      view.setUint32(centralOffset + 42, zipLocalOffset(source, 'word/document.xml'), true);
    });
    await expectCode(
      extractProjectChatDocument('docx', aliasedPayload, 60_000),
      'attachment_invalid',
    );
  });

  it('rejects malformed UTF-8 and never splits a trailing surrogate pair', async () => {
    await expectCode(
      extractProjectChatDocument('text', Uint8Array.from([0xc3, 0x28]), 60_000),
      'attachment_invalid',
    );
    const result = await extractProjectChatDocument('text', strToU8('A😀B'), 2);
    expect(result.units[0]?.text).toBe('A');
    expect(result.extractedCharacters).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('bounds cleanup work and fails closed on detectable legacy encryption markers', async () => {
    const bounded = await extractProjectChatDocument(
      'text',
      strToU8(`${' '.repeat(2_000_000)}not-reached`),
      10,
    );
    expect(bounded).toMatchObject({ truncated: true, extractedCharacters: 0 });

    const encrypted = new Uint8Array(
      Buffer.concat([
        Buffer.from(legacyPptFixture('hidden')),
        Buffer.from('EncryptionInfo', 'utf16le'),
      ]),
    );
    await expectCode(extractProjectChatDocument('ppt', encrypted, 60_000), 'attachment_encrypted');
  });
});
