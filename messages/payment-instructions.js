const PaymentInstructionsMessages = {
  // Syntax / Parsing
  MISSING_REQUIRED_KEYWORD: 'Missing required keyword in instruction', // SY01
  INVALID_KEYWORD_ORDER: 'Invalid keyword order in instruction', // SY02
  MALFORMED_INSTRUCTION: 'Malformed instruction: unable to parse keywords', // SY03

  // Amount / Number validation
  AMOUNT_MUST_BE_POSITIVE_INTEGER: 'Amount must be a positive integer', // AM01

  // Currency validation
  UNSUPPORTED_CURRENCY: 'Unsupported currency. Only NGN, USD, GBP, and GHS are supported', // CU02
  ACCOUNT_CURRENCY_MISMATCH: 'Account currency mismatch', // CU01

  // Account validation
  ACCOUNT_NOT_FOUND: 'Account not found', // AC03
  INVALID_ACCOUNT_ID_FORMAT:
    'Invalid account ID format. Allowed characters: letters, numbers, hyphen (-), dot (.), at (@).', // AC04
  DEBIT_CREDIT_SAME_ACCOUNT: 'Debit and credit accounts cannot be the same', // AC02

  // Funds / business rules
  INSUFFICIENT_FUNDS: 'Insufficient funds in debit account', // AC01

  // Date / scheduling
  INVALID_DATE_FORMAT: 'Invalid date format. Expected YYYY-MM-DD', // DT01
  TRANSACTION_SCHEDULED: 'Transaction scheduled for future execution', // AP02
  TRANSACTION_EXECUTED: 'Transaction executed successfully', // AP00

  // Generic / fallback
  INTERNAL_ERROR: 'Internal server error',
};

module.exports = PaymentInstructionsMessages;
