const validator = require('@app-core/validator');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { appLogger, TimeLogger } = require('@app-core/logger');
const PaymentMessages = require('@app/messages/payment-instructions');

// -----------------------------
// VSL Spec (validate incoming payload)
// -----------------------------
const spec = `root {
  accounts[] {
    id string
    balance number
    currency string
  }
  instruction string<trim>
}`;

const parsedSpec = validator.parse(spec);

// -----------------------------
// Helper utilities (no regex)
// -----------------------------

/**
 * Tokenize instruction string into non-empty tokens.
 * Handles multiple spaces and tabs by replacing tabs with spaces, trimming,
 * and splitting on single-space then filtering empty tokens.
 */
function tokenize(instruction) {
  if (instruction === undefined || instruction === null) return [];
  let s = String(instruction);
  // Replace tab characters with single space (no regex)
  while (s.indexOf('\t') !== -1) s = s.replace('\t', ' ');
  s = s.trim();
  if (s.length === 0) return [];
  const parts = s.split(' ');
  const tokens = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) tokens.push(parts[i]);
  }
  return tokens;
}

/**
 * Validate account ID characters: letters, numbers, hyphen (-), dot (.), at (@)
 */
function isValidAccountId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  const allowed = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.@';
  for (let i = 0; i < id.length; i++) {
    if (allowed.indexOf(id[i]) === -1) return false;
  }
  return true;
}

/**
 * Check if a string represents a positive integer (no decimals, no sign).
 */
function isPositiveIntegerString(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  // each char must be 0-9
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch < '0' || ch > '9') return false;
  }
  // parse and ensure > 0
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n <= 0) return false;
  return true;
}

/**
 * Parse YYYY-MM-DD to { year, month, day } or return null for invalid format.
 * DOES NOT use regex.
 */
function parseDateYYYYMMDD(dateStr) {
  if (typeof dateStr !== 'string') return null;
  if (dateStr.length !== 10) return null;
  if (dateStr[4] !== '-' || dateStr[7] !== '-') return null;
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(5, 7);
  const d = dateStr.substring(8, 10);
  // ensure digits
  for (let i = 0; i < y.length; i++) if (y[i] < '0' || y[i] > '9') return null;
  for (let i = 0; i < m.length; i++) if (m[i] < '0' || m[i] > '9') return null;
  for (let i = 0; i < d.length; i++) if (d[i] < '0' || d[i] > '9') return null;
  const yi = parseInt(y, 10);
  const mi = parseInt(m, 10);
  const di = parseInt(d, 10);
  if (mi < 1 || mi > 12) return null;
  if (di < 1 || di > 31) return null;
  return { year: yi, month: mi, day: di };
}

/**
 * Compare parsed date object {year,month,day} with today's UTC date.
 * Returns -1 if date < today, 0 if equal, 1 if date > today.
 */
function compareDateToTodayUTC(dateObj) {
  const now = new Date();
  const ty = now.getUTCFullYear();
  const tm = now.getUTCMonth() + 1;
  const td = now.getUTCDate();
  if (dateObj.year < ty) return -1;
  if (dateObj.year > ty) return 1;
  if (dateObj.month < tm) return -1;
  if (dateObj.month > tm) return 1;
  if (dateObj.day < td) return -1;
  if (dateObj.day > td) return 1;
  return 0;
}

/**
 * Find account in provided accounts array preserving original order knowledge.
 * Returns { index, account } or null.
 */
function findAccount(accounts, id) {
  for (let i = 0; i < accounts.length; i++) {
    if (accounts[i].id === id) return { index: i, account: accounts[i] };
  }
  return null;
}

// Supported currencies (uppercase)
const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GBP', 'GHS'];

// -----------------------------
// Main service function
// -----------------------------
async function paymentInstructions(serviceData, options = {}) {
  // Single exit point: result and return are assigned at the end.
  let result;

  // TIME LOGGER for diagnostic
  const timeLogger = new TimeLogger('parse-payment-instructions');
  timeLogger.start('validate-input');

  // 1) Validate incoming data using VSL spec
  let data;
  try {
    data = validator.validate(serviceData, parsedSpec);
  } catch (err) {
    // Validation failed at schema level - rethrow as application error so framework formats response
    appLogger.errorX(
      { error: err, payload: serviceData },
      'parse-payment-instructions.validation-failed'
    );
    // Throw framework-style application error using messages
    throwAppError(PaymentMessages.MALFORMED_INSTRUCTION, ERROR_CODE.VALIDATIONERR);
  }

  timeLogger.end('validate-input');
  timeLogger.start('parse-instruction');

  // Initialize default response skeleton with nulls (for unparseable cases)
  const baseResponse = {
    type: null,
    amount: null,
    currency: null,
    debit_account: null,
    credit_account: null,
    execute_by: null,
    status: 'failed',
    status_reason: '',
    status_code: '',
    accounts: [],
  };

  try {
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const instructionRaw = data.instruction;

    // Tokenize
    const tokens = tokenize(instructionRaw);
    if (!tokens || tokens.length === 0) {
      // Completely unparseable
      result = {
        ...baseResponse,
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
        status_code: 'SY03',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Normalize lowercase tokens for keyword detection, keep original tokens for account IDs
    const lowerTokens = [];
    for (let i = 0; i < tokens.length; i++) lowerTokens.push(tokens[i].toLowerCase());

    // First token must be DEBIT or CREDIT
    const first = lowerTokens[0];
    if (first !== 'debit' && first !== 'credit') {
      // Missing required starting keyword
      result = {
        ...baseResponse,
        status_reason: PaymentMessages.MISSING_REQUIRED_KEYWORD,
        status_code: 'SY01',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }
    const type = first.toUpperCase();

    // Next tokens expected: amount (token[1]) and currency (token[2])
    if (tokens.length < 3) {
      result = {
        ...baseResponse,
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
        status_code: 'SY03',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    const amountToken = tokens[1];
    const currencyToken = tokens[2];

    // Amount validation: positive integer string
    if (!isPositiveIntegerString(String(amountToken))) {
      result = {
        ...baseResponse,
        type,
        amount: null,
        currency: currencyToken ? String(currencyToken).toUpperCase() : null,
        status_reason: PaymentMessages.AMOUNT_MUST_BE_POSITIVE_INTEGER,
        status_code: 'AM01',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }
    const amount = parseInt(amountToken, 10);

    // Currency normalized uppercase
    const currency = String(currencyToken).toUpperCase();
    if (SUPPORTED_CURRENCIES.indexOf(currency) === -1) {
      // Unsupported currency
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        status_reason: PaymentMessages.UNSUPPORTED_CURRENCY,
        status_code: 'CU02',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Now parse the rest depending on type (DEBIT vs CREDIT)
    // We must enforce keyword order exactly per spec.
    let debitAccountId = null;
    let creditAccountId = null;
    let executeBy = null; // string or null
    const parsedDate = null; // {year,month,day} or null

    if (type === 'DEBIT') {
      // Expect sequence: DEBIT [amount] [currency] FROM ACCOUNT [acct] FOR CREDIT TO ACCOUNT [acct] [ON date]
      // Find 'from' starting search from index 3
      const iFrom = lowerTokens.indexOf('from', 3);
      if (iFrom === -1) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MISSING_REQUIRED_KEYWORD,
          status_code: 'SY01',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      // Check ACCOUNT
      if (iFrom + 1 >= lowerTokens.length || lowerTokens[iFrom + 1] !== 'account') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFrom + 2 >= tokens.length) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      debitAccountId = tokens[iFrom + 2]; // account IDs are case-sensitive

      // find 'for' after that
      const iFor = lowerTokens.indexOf('for', iFrom + 3);
      if (iFor === -1) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MISSING_REQUIRED_KEYWORD,
          status_code: 'SY01',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      // expect 'credit' 'to' 'account' [id]
      if (iFor + 1 >= lowerTokens.length || lowerTokens[iFor + 1] !== 'credit') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 2 >= lowerTokens.length || lowerTokens[iFor + 2] !== 'to') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 3 >= lowerTokens.length || lowerTokens[iFor + 3] !== 'account') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 4 >= tokens.length) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      creditAccountId = tokens[iFor + 4];

      // optional ON clause after iFor + 5
      const iOn = lowerTokens.indexOf('on', iFor + 5);
      if (iOn !== -1) {
        if (iOn + 1 >= tokens.length) {
          result = {
            ...baseResponse,
            type,
            amount,
            currency,
            debit_account: debitAccountId,
            credit_account: creditAccountId,
            status_reason: PaymentMessages.INVALID_DATE_FORMAT,
            status_code: 'DT01',
            accounts: [],
          };
          timeLogger.end('parse-instruction');
          return result;
        }
        executeBy = tokens[iOn + 1];
      }
    } else {
      // CREDIT format
      // Expect: CREDIT [amount] [currency] TO ACCOUNT [acct] FOR DEBIT FROM ACCOUNT [acct] [ON date]
      const iTo = lowerTokens.indexOf('to', 3);
      if (iTo === -1) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MISSING_REQUIRED_KEYWORD,
          status_code: 'SY01',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iTo + 1 >= lowerTokens.length || lowerTokens[iTo + 1] !== 'account') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iTo + 2 >= tokens.length) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      creditAccountId = tokens[iTo + 2];

      // find 'for' after that
      const iFor = lowerTokens.indexOf('for', iTo + 3);
      if (iFor === -1) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MISSING_REQUIRED_KEYWORD,
          status_code: 'SY01',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      // expect 'debit' 'from' 'account' [id]
      if (iFor + 1 >= lowerTokens.length || lowerTokens[iFor + 1] !== 'debit') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 2 >= lowerTokens.length || lowerTokens[iFor + 2] !== 'from') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 3 >= lowerTokens.length || lowerTokens[iFor + 3] !== 'account') {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.INVALID_KEYWORD_ORDER,
          status_code: 'SY02',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      if (iFor + 4 >= tokens.length) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      debitAccountId = tokens[iFor + 4];

      // optional ON clause after iFor + 5
      const iOn = lowerTokens.indexOf('on', iFor + 5);
      if (iOn !== -1) {
        if (iOn + 1 >= tokens.length) {
          result = {
            ...baseResponse,
            type,
            amount,
            currency,
            debit_account: debitAccountId,
            credit_account: creditAccountId,
            status_reason: PaymentMessages.INVALID_DATE_FORMAT,
            status_code: 'DT01',
            accounts: [],
          };
          timeLogger.end('parse-instruction');
          return result;
        }
        executeBy = tokens[iOn + 1];
      }
    }

    // Validate account ID formats
    if (!isValidAccountId(debitAccountId)) {
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        status_reason: PaymentMessages.INVALID_ACCOUNT_ID_FORMAT,
        status_code: 'AC04',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }
    if (!isValidAccountId(creditAccountId)) {
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        status_reason: PaymentMessages.INVALID_ACCOUNT_ID_FORMAT,
        status_code: 'AC04',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Validate and parse date if present
    let parsedDateObj = null;
    if (executeBy !== null && executeBy !== undefined) {
      const pd = parseDateYYYYMMDD(String(executeBy));
      if (pd === null) {
        result = {
          ...baseResponse,
          type,
          amount,
          currency,
          debit_account: debitAccountId,
          credit_account: creditAccountId,
          execute_by: executeBy,
          status_reason: PaymentMessages.INVALID_DATE_FORMAT,
          status_code: 'DT01',
          accounts: [],
        };
        timeLogger.end('parse-instruction');
        return result;
      }
      parsedDateObj = pd;
    }

    // Find accounts in provided accounts array preserving original order
    const debitEntry = findAccount(accounts, debitAccountId);
    const creditEntry = findAccount(accounts, creditAccountId);

    if (!debitEntry || !creditEntry) {
      // Account not found (AC03) - returned accounts should be empty per spec when accounts cannot be identified
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: PaymentMessages.ACCOUNT_NOT_FOUND,
        status_code: 'AC03',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Currency match validation between accounts
    const debitAccCurr = String(debitEntry.account.currency || '').toUpperCase();
    const creditAccCurr = String(creditEntry.account.currency || '').toUpperCase();
    if (debitAccCurr !== creditAccCurr) {
      // CU01
      // Build accounts array (in same order as request) but unchanged balances
      const accountsOut = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        if (a.id === debitEntry.account.id || a.id === creditEntry.account.id) {
          accountsOut.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: String(a.currency || '').toUpperCase(),
          });
        }
      }
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: PaymentMessages.ACCOUNT_CURRENCY_MISMATCH,
        status_code: 'CU01',
        accounts: accountsOut,
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Instruction currency must match account currencies
    if (debitAccCurr !== currency) {
      const accountsOut = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        if (a.id === debitEntry.account.id || a.id === creditEntry.account.id) {
          accountsOut.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: String(a.currency || '').toUpperCase(),
          });
        }
      }
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: PaymentMessages.UNSUPPORTED_CURRENCY,
        status_code: 'CU02',
        accounts: accountsOut,
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Debit and credit accounts must differ
    if (debitEntry.account.id === creditEntry.account.id) {
      const accountsOut = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        if (a.id === debitEntry.account.id || a.id === creditEntry.account.id) {
          accountsOut.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: String(a.currency || '').toUpperCase(),
          });
        }
      }
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: PaymentMessages.DEBIT_CREDIT_SAME_ACCOUNT,
        status_code: 'AC02',
        accounts: accountsOut,
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Amount is positive integer already validated
    if (!Number.isInteger(amount) || amount <= 0) {
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: PaymentMessages.AMOUNT_MUST_BE_POSITIVE_INTEGER,
        status_code: 'AM01',
        accounts: [],
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Date logic: if parsedDateObj exists and parsedDateObj > today -> pending
    let willExecuteNow = true;
    if (parsedDateObj) {
      const cmp = compareDateToTodayUTC(parsedDateObj);
      if (cmp === 1) {
        willExecuteNow = false;
      } else {
        willExecuteNow = true;
      }
    }

    // If pending -> return pending status, do not modify balances
    if (!willExecuteNow) {
      // Build accounts array in the same order as request's accounts but only include the two involved
      const accountsOut = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        if (a.id === debitEntry.account.id || a.id === creditEntry.account.id) {
          accountsOut.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: String(a.currency || '').toUpperCase(),
          });
        }
      }

      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status: 'pending',
        status_reason: PaymentMessages.TRANSACTION_SCHEDULED,
        status_code: 'AP02',
        accounts: accountsOut,
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Execution now: check sufficient funds in debit account
    const debitBalanceBefore = Number(debitEntry.account.balance);
    const creditBalanceBefore = Number(creditEntry.account.balance);
    if (Number.isNaN(debitBalanceBefore) || Number.isNaN(creditBalanceBefore)) {
      // Internal data error - throw application error
      appLogger.error(
        { debitEntry, creditEntry },
        'parse-payment-instructions.invalid-account-balances'
      );
      throwAppError(PaymentMessages.INTERNAL_ERROR, ERROR_CODE.APPERR);
    }
    if (debitBalanceBefore < amount) {
      // Insufficient funds AC01
      const accountsOut = [];
      for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        if (a.id === debitEntry.account.id || a.id === creditEntry.account.id) {
          accountsOut.push({
            id: a.id,
            balance: a.balance,
            balance_before: a.balance,
            currency: String(a.currency || '').toUpperCase(),
          });
        }
      }
      result = {
        ...baseResponse,
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy || null,
        status_reason: `${PaymentMessages.INSUFFICIENT_FUNDS}: has ${debitBalanceBefore} ${currency}, needs ${amount} ${currency}`,
        status_code: 'AC01',
        accounts: accountsOut,
      };
      timeLogger.end('parse-instruction');
      return result;
    }

    // Perform transfer (in-memory only; no persistence required)
    const newDebitBalance = debitBalanceBefore - amount;
    const newCreditBalance = creditBalanceBefore + amount;

    // Build accountsOut with ordering based on original request order
    const accountsOutAfter = [];
    for (let i = 0; i < accounts.length; i++) {
      const a = accounts[i];
      if (a.id === debitEntry.account.id) {
        accountsOutAfter.push({
          id: a.id,
          balance: newDebitBalance,
          balance_before: debitBalanceBefore,
          currency: String(a.currency || '').toUpperCase(),
        });
      } else if (a.id === creditEntry.account.id) {
        accountsOutAfter.push({
          id: a.id,
          balance: newCreditBalance,
          balance_before: creditBalanceBefore,
          currency: String(a.currency || '').toUpperCase(),
        });
      }
    }

    // Final successful response
    result = {
      ...baseResponse,
      type,
      amount,
      currency,
      debit_account: debitAccountId,
      credit_account: creditAccountId,
      execute_by: executeBy || null,
      status: 'successful',
      status_reason: PaymentMessages.TRANSACTION_EXECUTED,
      status_code: 'AP00',
      accounts: accountsOutAfter,
    };

    timeLogger.end('parse-instruction');
    return result;
  } catch (err) {
    // Unexpected internal error - log and throw as framework error
    appLogger.errorX({ error: err }, 'parse-payment-instructions.unexpected-error');
    // Use generic internal error message
    throwAppError(PaymentMessages.INTERNAL_ERROR, ERROR_CODE.APPERR);
  }
}

module.exports = paymentInstructions;
