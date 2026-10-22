// Columnar snapshot format "SNP1":
//   bytes 0-3   magic "SNP1"
//   bytes 4-7   uint32 LE: header length H (JSON, space-padded so that 8 + H is a multiple of 4)
//   bytes 8..   JSON header { schema, asof, built, rows, columns: [names], symbols: [], names: [], exchanges: [], etf: [] }
//   then        one Float32 (little endian) array of `rows` values per column, in header order. NaN = missing.
export const SCHEMA = 1;

export function writeSnapshot({ asof, built, symbols, names, exchanges, etf, columns }) {
  const rows = symbols.length;
  const columnNames = Object.keys(columns);
  const header = { schema: SCHEMA, asof, built, rows, columns: columnNames, symbols, names, exchanges, etf };
  let json = JSON.stringify(header);
  const bytes = new TextEncoder().encode(json);
  const pad = (4 - ((8 + bytes.length) % 4)) % 4;
  const headerBytes = new Uint8Array(bytes.length + pad).fill(0x20);
  headerBytes.set(bytes);
  const buf = new ArrayBuffer(8 + headerBytes.length + columnNames.length * rows * 4);
  const view = new DataView(buf);
  new Uint8Array(buf, 0, 4).set([0x53, 0x4e, 0x50, 0x31]); // "SNP1"
  view.setUint32(4, headerBytes.length, true);
  new Uint8Array(buf, 8, headerBytes.length).set(headerBytes);
  let offset = 8 + headerBytes.length;
  for (const name of columnNames) {
    new Float32Array(buf, offset, rows).set(columns[name]);
    offset += rows * 4;
  }
  return new Uint8Array(buf);
}

/** Reader used by the Functions and the tests: returns { header, col(name) -> Float32Array view }. */
export function readSnapshot(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const magic = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  if (magic !== "SNP1") throw new Error("bad snapshot magic");
  const headerLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 8, headerLen)));
  const base = 8 + headerLen;
  const col = (name) => {
    const i = header.columns.indexOf(name);
    if (i < 0) throw new Error(`no column ${name}`);
    return new Float32Array(arrayBuffer, base + i * header.rows * 4, header.rows);
  };
  return { header, col };
}
