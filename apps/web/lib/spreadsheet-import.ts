export interface SpreadsheetData {
  headers: string[];
  rows: string[][];
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; value = "";
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findEndOfCentralDirectory(view: DataView) {
  const start = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("O arquivo XLSX não contém uma estrutura ZIP válida.");
}

async function readZipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const endOffset = findEndOfCentralDirectory(view);
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("A estrutura interna da planilha está inválida.");
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { method, size, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return async (path: string) => {
    const entry = entries.get(path);
    if (!entry) return null;
    const localNameLength = view.getUint16(entry.offset + 26, true);
    const localExtraLength = view.getUint16(entry.offset + 28, true);
    const dataStart = entry.offset + 30 + localNameLength + localExtraLength;
    const compressedSize = view.getUint32(entry.offset + 18, true);
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (entry.method === 0) return decoder.decode(compressed);
    if (entry.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("Este navegador não consegue abrir esta planilha. Salve-a como CSV e importe novamente.");
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      const result = await new Response(stream).arrayBuffer();
      if (result.byteLength !== entry.size) throw new Error("Tamanho inválido");
      return decoder.decode(result);
    } catch {
      throw new Error("Não foi possível descompactar a planilha. Salve-a como CSV e importe novamente.");
    }
  };
}

function xmlElements(document: Document, name: string) {
  return Array.from(document.getElementsByTagNameNS("*", name));
}

async function parseXlsx(file: File): Promise<string[][]> {
  const readEntry = await readZipEntries(await file.arrayBuffer());
  const parser = new DOMParser();
  const readXml = async (path: string) => {
    const content = await readEntry(path);
    if (!content) return null;
    const document = parser.parseFromString(content, "application/xml");
    if (xmlElements(document, "parsererror").length) throw new Error("Uma das partes da planilha XLSX está inválida.");
    return document;
  };
  const workbook = await readXml("xl/workbook.xml");
  const relations = await readXml("xl/_rels/workbook.xml.rels");
  if (!workbook || !relations) throw new Error("Não foi possível localizar a primeira aba da planilha.");
  const sheet = xmlElements(workbook, "sheet")[0];
  const relationId = sheet?.getAttribute("r:id") ?? sheet?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const relation = xmlElements(relations, "Relationship").find((item) => item.getAttribute("Id") === relationId);
  const target = relation?.getAttribute("Target");
  if (!target) throw new Error("A planilha não contém uma aba legível.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const worksheet = await readXml(sheetPath);
  if (!worksheet) throw new Error("Não foi possível ler os dados da primeira aba.");
  const stringsXml = await readXml("xl/sharedStrings.xml");
  const sharedStrings = stringsXml ? xmlElements(stringsXml, "si").map((item) => xmlElements(item as unknown as Document, "t").map((text) => text.textContent ?? "").join("")) : [];
  const grid: string[][] = [];
  for (const rowElement of xmlElements(worksheet, "row")) {
    const rowNumber = Number(rowElement.getAttribute("r") ?? grid.length + 1) - 1;
    const row: string[] = [];
    for (const cell of xmlElements(rowElement as unknown as Document, "c")) {
      const address = cell.getAttribute("r") ?? "A1";
      const letters = address.match(/^[A-Z]+/i)?.[0] ?? "A";
      const column = [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const valueElement = xmlElements(cell as unknown as Document, "v")[0];
      const type = cell.getAttribute("t");
      const value = type === "inlineStr"
        ? xmlElements(cell as unknown as Document, "t").map((text) => text.textContent ?? "").join("")
        : valueElement?.textContent ?? "";
      row[column] = type === "s" ? sharedStrings[Number(value)] ?? "" : value;
    }
    grid[rowNumber] = row.map((value) => value ?? "");
  }
  return grid.filter((row) => row?.some((cell) => cell.trim()));
}

export async function parseGradeSpreadsheet(file: File): Promise<SpreadsheetData> {
  if (file.size > 5 * 1024 * 1024) throw new Error("O arquivo deve ter até 5 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const rows = extension === "csv"
    ? parseCsv(await file.text())
    : extension === "xlsx"
      ? await parseXlsx(file)
      : null;
  if (!rows || rows.length < 2) throw new Error("Envie um arquivo CSV ou XLSX com cabeçalho e pelo menos uma linha de notas.");
  const headers = rows[0].map((value) => value.trim());
  if (headers.some((value) => !value)) throw new Error("Preencha o nome de todas as colunas no cabeçalho.");
  return { headers, rows: rows.slice(1) };
}
