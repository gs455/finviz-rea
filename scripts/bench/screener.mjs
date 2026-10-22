// The planned /api/screener step: filter + sort the nightly snapshot and return one page of rows.
// Two input formats are measured:
//   binary: a JSON header (tickers, column offsets) followed by float32 columns read through typed-array views
//   json:   one column-oriented JSON text that must be JSON.parse'd on every cold start

// Query used for the benchmark: the reference scenario (price over $1, average volume over 50K),
// sorted by after-hours change, top 120 rows.
export const QUERY = { minPrice: 1, minAvgVol: 50000, sortBy: 'ahChange', descending: true, limit: 120 };
const OUTPUT_COLUMNS = ['price', 'change', 'ahChange', 'volume', 'avgVol', 'marketCap', 'relVol', 'rsi', 'sma20', 'sma50', 'sma200', 'perfWeek'];

function pickPage(columnOf, tickers, query) {
  const price = columnOf('price');
  const avgVol = columnOf('avgVol');
  const sortColumn = columnOf(query.sortBy);

  const matches = [];
  for (let i = 0; i < price.length; i++) {
    if (price[i] > query.minPrice && avgVol[i] > query.minAvgVol) matches.push(i);
  }
  const sign = query.descending ? -1 : 1;
  matches.sort((a, b) => sign * (sortColumn[a] - sortColumn[b]));
  const page = matches.slice(0, query.limit);

  const columns = OUTPUT_COLUMNS.map((name) => {
    const values = columnOf(name);
    return page.map((i) => values[i]);
  });
  return JSON.stringify({ total: matches.length, tickers: page.map((i) => tickers[i]), cols: OUTPUT_COLUMNS, columns });
}

// buffer: ArrayBuffer of float32 columns. header: { rows, columns: [{name, offset}], tickers }.
export function screenBinary(buffer, headerText, query = QUERY) {
  const header = JSON.parse(headerText);
  const offsets = new Map(header.columns.map((column) => [column.name, column.offset]));
  const columnOf = (name) => new Float32Array(buffer, offsets.get(name), header.rows);
  return pickPage(columnOf, header.tickers, query);
}

export function screenJson(jsonText, query = QUERY) {
  const data = JSON.parse(jsonText);
  return pickPage((name) => data[name], data.tickers, query);
}
