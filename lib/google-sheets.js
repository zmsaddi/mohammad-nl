import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getAuth() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: SCOPES,
  });
  return auth;
}

function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Sheet names
const SHEETS = {
  PURCHASES: 'المشتريات',
  SALES: 'المبيعات',
  EXPENSES: 'المصاريف',
  CLIENTS: 'العملاء',
  PAYMENTS: 'سجل الدفعات',
  USERS: 'المستخدمين',
};

// Get all rows from a sheet
export async function getRows(sheetName) {
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return [];

  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] || '';
    });
    return obj;
  });
}

// Append a row to a sheet
export async function appendRow(sheetName, values) {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values],
    },
  });
}

// Get the next ID for a sheet
export async function getNextId(sheetName) {
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return 1;

  const ids = rows.slice(1).map((r) => parseInt(r[0]) || 0);
  return Math.max(...ids) + 1;
}

// Delete a row by ID (column A)
export async function deleteRowById(sheetName, id) {
  const sheets = getSheets();

  // First get all data to find the row index
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
  });

  const rows = response.data.values;
  if (!rows) return false;

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === String(id)) {
      rowIndex = i;
      break;
    }
  }

  if (rowIndex === -1) return false;

  // Get the sheet ID
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const sheet = spreadsheet.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

  if (!sheet) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return true;
}

// Update a row by ID
export async function updateRowById(sheetName, id, values) {
  const sheets = getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
  });

  const rows = response.data.values;
  if (!rows) return false;

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === String(id)) {
      rowIndex = i + 1; // 1-indexed for Sheets API
      break;
    }
  }

  if (rowIndex === -1) return false;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values],
    },
  });

  return true;
}

export { SHEETS, SPREADSHEET_ID };
